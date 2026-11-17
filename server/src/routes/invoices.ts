import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type Stripe from 'stripe';
import type { InvoiceItem, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { optionalDate } from '../lib/validators.js';
import { me, requireAdmin, requireStaff } from '../middleware/auth.js';
import { invoiceScope, isStaff } from '../lib/access.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { notify } from '../lib/notify.js';
import { emitToUser } from '../lib/realtime.js';
import { sendEmail } from '../lib/mailer.js';

export const invoicesRouter = Router();

export const invoiceTotal = (items: Pick<InvoiceItem, 'quantity' | 'unitAmount'>[]) =>
  items.reduce((s, i) => s + i.quantity * i.unitAmount, 0);

const money = (cents: number, currency: string) => {
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 10 ** digits);
  } catch {
    return `${cents} ${currency.toUpperCase()}`;
  }
};

const itemInput = z.object({
  description: z.string().trim().min(1, 'Describe the line item').max(500),
  quantity: z.number().int().min(1).max(1_000_000),
  unitAmount: z.number().int().min(0).max(100_000_000_00),
});

const invoiceInput = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  projectId: z.string().nullable().optional(),
  currency: z
    .string()
    .regex(/^[a-zA-Z]{3}$/)
    .transform((v) => v.toLowerCase())
    .optional(),
  dueDate: optionalDate,
  notes: z.string().max(5000).optional(),
  items: z.array(itemInput).min(1, 'Add at least one line item').max(100),
});

const include = {
  items: { orderBy: { position: 'asc' as const } },
  client: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true } },
};

type FullInvoice = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;
const loadInvoice = (id: string) => prisma.invoice.findUnique({ where: { id }, include });

const serialize = (inv: FullInvoice) => ({ ...inv, total: invoiceTotal(inv.items) });

async function getInvoice(user: User, id: string) {
  const inv = await prisma.invoice.findFirst({ where: { id, ...invoiceScope(user) }, include });
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

async function clientUserIds(clientId: string) {
  const users = await prisma.user.findMany({ where: { clientId, deactivatedAt: null }, select: { id: true, email: true } });
  return users;
}

async function staffIds(orgId: string) {
  const users = await prisma.user.findMany({ where: { orgId, role: { not: 'CLIENT' }, deactivatedAt: null }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Push an "invoice changed" ping to everyone who can see it. */
async function broadcast(inv: { id: string; orgId: string; clientId: string; status: string }) {
  const ids = [...(await staffIds(inv.orgId)), ...(inv.status === 'DRAFT' ? [] : (await clientUserIds(inv.clientId)).map((u) => u.id))];
  for (const id of ids) emitToUser(id, 'invoice:changed', { invoiceId: inv.id });
}

/** Idempotently marks an invoice paid (called from webhook, return-redirect verification and manual). */
export async function markInvoicePaid(invoiceId: string, data: { sessionId?: string; paymentIntentId?: string | null; via: string }) {
  const res = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: 'OPEN' },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      ...(data.sessionId ? { stripeSessionId: data.sessionId } : {}),
      ...(data.paymentIntentId ? { stripePaymentIntentId: data.paymentIntentId } : {}),
    },
  });
  if (res.count !== 1) return false;
  const inv = (await loadInvoice(invoiceId))!;
  const total = money(invoiceTotal(inv.items), inv.currency);
  await notify([...(await staffIds(inv.orgId)), ...(await clientUserIds(inv.clientId)).map((u) => u.id)], {
    type: 'invoice.paid',
    title: `💰 Invoice ${inv.number} paid`,
    body: `${inv.client.name} paid ${total}${data.via === 'manual' ? ' (recorded manually)' : ''}`,
    link: `/invoices/${inv.id}`,
  });
  await broadcast(inv);
  return true;
}

invoicesRouter.get('/', async (req, res) => {
  const user = me(req);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
  const invoices = await prisma.invoice.findMany({
    where: {
      ...invoiceScope(user),
      ...(status && ['DRAFT', 'OPEN', 'PAID', 'VOID'].includes(status) ? { status: status as never } : {}),
      ...(clientId && isStaff(user) ? { clientId } : {}),
    },
    include,
    orderBy: { createdAt: 'desc' },
  });
  res.json(invoices.map(serialize));
});

invoicesRouter.post('/', requireStaff, async (req, res) => {
  const user = me(req);
  const body = parse(invoiceInput, req.body);
  const client = await prisma.client.findFirst({ where: { id: body.clientId, orgId: user.orgId } });
  if (!client) throw notFound('Client not found');
  if (body.projectId) {
    const p = await prisma.project.findFirst({ where: { id: body.projectId, clientId: client.id } });
    if (!p) throw badRequest('Project does not belong to this client');
  }
  const inv = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: user.orgId },
      data: { invoiceCounter: { increment: 1 } },
    });
    return tx.invoice.create({
      data: {
        orgId: user.orgId,
        clientId: client.id,
        projectId: body.projectId ?? null,
        number: `INV-${String(org.invoiceCounter).padStart(4, '0')}`,
        currency: body.currency ?? org.currency,
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? '',
        items: { create: body.items.map((it, position) => ({ ...it, position })) },
      },
      include,
    });
  });
  res.status(201).json(serialize(inv));
});

invoicesRouter.get('/:id', async (req, res) => {
  res.json(serialize(await getInvoice(me(req), param(req, 'id'))));
});

invoicesRouter.patch('/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const inv = await getInvoice(user, param(req, 'id'));
  const body = parse(invoiceInput.partial(), req.body);
  if (inv.status !== 'DRAFT') {
    // Only cosmetic fields can change once an invoice has been sent.
    const allowed = ['notes', 'dueDate'];
    if (Object.keys(body).some((k) => !allowed.includes(k))) throw badRequest('Only notes and due date can be edited after sending');
  }
  if (body.clientId && body.clientId !== inv.clientId) {
    const c = await prisma.client.findFirst({ where: { id: body.clientId, orgId: user.orgId } });
    if (!c) throw notFound('Client not found');
  }
  if (body.projectId) {
    const p = await prisma.project.findFirst({ where: { id: body.projectId, clientId: body.clientId ?? inv.clientId } });
    if (!p) throw badRequest('Project does not belong to this client');
  }
  const { items, ...fields } = body;
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: fields });
    if (items) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
      await tx.invoiceItem.createMany({ data: items.map((it, position) => ({ ...it, position, invoiceId: inv.id })) });
    }
  });
  const updated = (await loadInvoice(inv.id))!;
  await broadcast(updated);
  res.json(serialize(updated));
});

invoicesRouter.delete('/:id', requireStaff, async (req, res) => {
  const inv = await getInvoice(me(req), param(req, 'id'));
  if (inv.status !== 'DRAFT') throw badRequest('Only draft invoices can be deleted — void it instead');
  await prisma.invoice.delete({ where: { id: inv.id } });
  res.json({ ok: true });
});

invoicesRouter.post('/:id/send', requireStaff, async (req, res) => {
  const user = me(req);
  const inv = await getInvoice(user, param(req, 'id'));
  if (inv.status !== 'DRAFT') throw badRequest('This invoice has already been sent');
  if (invoiceTotal(inv.items) <= 0) throw badRequest('Invoice total must be greater than zero');
  const updated = await prisma.invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
    include,
  });
  const total = money(invoiceTotal(updated.items), updated.currency);
  const recipients = await clientUserIds(inv.clientId);
  await notify(
    recipients.map((u) => u.id),
    {
      type: 'invoice.sent',
      title: `New invoice ${updated.number}`,
      body: `${total}${updated.dueDate ? ` due ${updated.dueDate.toISOString().slice(0, 10)}` : ''}`,
      link: `/invoices/${updated.id}`,
    },
  );
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
  const emails = new Set([...recipients.map((u) => u.email), ...(inv.client.email ? [inv.client.email] : [])]);
  await Promise.all(
    [...emails].map((to) =>
      sendEmail(
        to,
        `Invoice ${updated.number} from ${org.name}`,
        `You have a new invoice from ${org.name} for ${total}.\n\nView and pay online: ${env.APP_URL}/invoices/${updated.id}`,
      ),
    ),
  );
  await broadcast(updated);
  res.json(serialize(updated));
});

invoicesRouter.post('/:id/void', requireStaff, async (req, res) => {
  const inv = await getInvoice(me(req), param(req, 'id'));
  if (inv.status === 'PAID') throw badRequest('Paid invoices cannot be voided');
  if (inv.status === 'VOID') throw badRequest('Invoice is already void');
  if (stripe && inv.stripeSessionId) {
    await stripe.checkout.sessions.expire(inv.stripeSessionId).catch(() => {});
  }
  const updated = await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'VOID' }, include });
  await broadcast(updated);
  res.json(serialize(updated));
});

/** Record an offline payment (bank transfer, cash…). */
invoicesRouter.post('/:id/mark-paid', requireAdmin, async (req, res) => {
  const inv = await getInvoice(me(req), param(req, 'id'));
  if (inv.status !== 'OPEN') throw badRequest('Only open invoices can be marked as paid');
  await markInvoicePaid(inv.id, { via: 'manual' });
  res.json(serialize((await loadInvoice(inv.id))!));
});

/** Creates (or reuses) a Stripe Checkout session and returns its URL. */
invoicesRouter.post('/:id/checkout', async (req, res) => {
  const user = me(req);
  const inv = await getInvoice(user, param(req, 'id'));
  if (!stripe) throw new HttpError(503, 'Online payments are not configured. Add STRIPE_SECRET_KEY to the server .env file.');
  if (inv.status !== 'OPEN') throw badRequest(inv.status === 'PAID' ? 'This invoice is already paid' : 'This invoice cannot be paid');

  if (inv.stripeSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(inv.stripeSessionId).catch(() => null);
    if (existing?.status === 'open' && existing.url) return res.json({ url: existing.url });
    if (existing?.payment_status === 'paid') {
      await markInvoicePaid(inv.id, { sessionId: existing.id, paymentIntentId: piId(existing), via: 'stripe' });
      throw badRequest('This invoice is already paid');
    }
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: inv.orgId } });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: inv.id,
      customer_email: user.role === 'CLIENT' ? user.email : (inv.client.email ?? undefined),
      line_items: inv.items.map((it) => ({
        quantity: it.quantity,
        price_data: {
          currency: inv.currency,
          unit_amount: it.unitAmount,
          product_data: { name: it.description.slice(0, 250) },
        },
      })),
      metadata: { invoiceId: inv.id, orgId: inv.orgId, invoiceNumber: inv.number },
      payment_intent_data: {
        description: `${org.name} — Invoice ${inv.number}`,
        metadata: { invoiceId: inv.id, orgId: inv.orgId },
      },
      success_url: `${env.APP_URL}/invoices/${inv.id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/invoices/${inv.id}?payment=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { stripeSessionId: session.id } });
    res.json({ url: session.url });
  } catch (err) {
    const e = err as { type?: string; message?: string };
    if (e.type?.startsWith('Stripe')) throw badRequest(`Stripe: ${e.message}`);
    throw err;
  }
});

/**
 * Called by the success page after Stripe redirects back. Lets payments register even
 * when webhooks aren't reachable (e.g. local development without the Stripe CLI).
 */
invoicesRouter.post('/:id/verify-payment', async (req, res) => {
  const user = me(req);
  const inv = await getInvoice(user, param(req, 'id'));
  const { sessionId } = parse(z.object({ sessionId: z.string().min(1) }), req.body);
  if (!stripe) throw new HttpError(503, 'Stripe is not configured');
  if (inv.status === 'OPEN') {
    const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
    if (!session || session.metadata?.invoiceId !== inv.id) throw forbidden('Payment session does not match this invoice');
    if (session.payment_status === 'paid') {
      await markInvoicePaid(inv.id, { sessionId: session.id, paymentIntentId: piId(session), via: 'stripe' });
    }
  }
  res.json(serialize((await loadInvoice(inv.id))!));
});

const piId = (s: Stripe.Checkout.Session) =>
  typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null);

/** Stripe webhook — mounted with a raw body parser in index.ts. */
export async function stripeWebhook(req: Request, res: Response) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Stripe webhooks not configured' });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, String(req.headers['stripe-signature']), env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId && session.payment_status === 'paid') {
      await markInvoicePaid(invoiceId, { sessionId: session.id, paymentIntentId: piId(session), via: 'stripe' });
    }
  }
  res.json({ received: true });
}
