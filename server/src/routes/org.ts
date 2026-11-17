import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { createToken } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { email, userPublic } from '../lib/validators.js';
import { me, requireAdmin, requireStaff } from '../middleware/auth.js';
import { storage } from '../lib/storage.js';
import { emailEnabled, sendEmail } from '../lib/mailer.js';
import { env } from '../lib/env.js';
import { isAdmin } from '../lib/access.js';
import { brandOf } from './auth.js';

export const orgRouter = Router();
orgRouter.use(requireStaff);

const INVITE_DAYS = 7;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

orgRouter.get('/', async (req, res) => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: me(req).orgId } });
  res.json(brandOf(org));
});

orgRouter.patch('/', requireAdmin, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      brandColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f46e5')
        .optional(),
      currency: z
        .string()
        .regex(/^[a-zA-Z]{3}$/, 'Use a 3-letter ISO currency code')
        .transform((v) => v.toLowerCase())
        .optional(),
    }),
    req.body,
  );
  const org = await prisma.organization.update({ where: { id: me(req).orgId }, data: body });
  res.json(brandOf(org));
});

orgRouter.post('/logo/upload-url', requireAdmin, async (req, res) => {
  const body = parse(
    z.object({ contentType: z.string(), size: z.number().int().positive().max(2 * 1024 * 1024, 'Logo must be under 2 MB') }),
    req.body,
  );
  if (!LOGO_TYPES.includes(body.contentType)) throw badRequest('Logo must be PNG, JPEG, WebP or GIF');
  const key = `orgs/${me(req).orgId}/logo/${crypto.randomUUID()}`;
  res.json({ key, upload: await storage.createUploadUrl(key, body.contentType) });
});

orgRouter.post('/logo', requireAdmin, async (req, res) => {
  const user = me(req);
  const { key } = parse(z.object({ key: z.string() }), req.body);
  if (!key.startsWith(`orgs/${user.orgId}/logo/`)) throw forbidden();
  const stat = await storage.stat(key);
  if (!stat) throw badRequest('Logo upload not found — please try again');
  if (stat.size > 2 * 1024 * 1024) {
    await storage.remove(key);
    throw badRequest('Logo must be under 2 MB');
  }
  const old = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
  const org = await prisma.organization.update({ where: { id: user.orgId }, data: { logoKey: key } });
  if (old.logoKey) await storage.remove(old.logoKey).catch(() => {});
  res.json(brandOf(org));
});

orgRouter.delete('/logo', requireAdmin, async (req, res) => {
  const user = me(req);
  const old = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
  const org = await prisma.organization.update({ where: { id: user.orgId }, data: { logoKey: null } });
  if (old.logoKey) await storage.remove(old.logoKey).catch(() => {});
  res.json(brandOf(org));
});

/** Team members (staff) and pending staff invites. */
orgRouter.get('/members', async (req, res) => {
  const orgId = me(req).orgId;
  const [members, invites] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, role: { not: 'CLIENT' }, deactivatedAt: null },
      select: { ...userPublic, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invite.findMany({
      where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() }, role: { not: 'CLIENT' } },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({ members, invites });
});

orgRouter.post('/invites', async (req, res) => {
  const user = me(req);
  const body = parse(
    z.object({
      email,
      role: z.enum(['ADMIN', 'MEMBER', 'CLIENT']),
      clientId: z.string().optional(),
    }),
    req.body,
  );
  if (body.role !== 'CLIENT' && !isAdmin(user)) throw forbidden('Only admins can invite team members');
  let clientName: string | null = null;
  if (body.role === 'CLIENT') {
    if (!body.clientId) throw badRequest('clientId is required for client invites');
    const client = await prisma.client.findFirst({ where: { id: body.clientId, orgId: user.orgId } });
    if (!client) throw notFound('Client not found');
    clientName = client.name;
  }
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw badRequest('A user with this email already exists', { email: 'Already has an account' });
  }

  // Re-inviting the same email replaces any earlier pending invite.
  await prisma.invite.deleteMany({ where: { orgId: user.orgId, email: body.email, acceptedAt: null } });
  const { token, hash } = createToken();
  const invite = await prisma.invite.create({
    data: {
      orgId: user.orgId,
      email: body.email,
      role: body.role,
      clientId: body.role === 'CLIENT' ? body.clientId : null,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
    },
  });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
  const inviteUrl = `${env.APP_URL}/invite/${token}`;
  const what = clientName ? `the ${clientName} client portal` : `the ${org.name} team`;
  const emailed = await sendEmail(
    body.email,
    `${user.name} invited you to ${org.name}`,
    `${user.name} has invited you to join ${what}.\n\nAccept the invitation: ${inviteUrl}\n\nThis link expires in ${INVITE_DAYS} days.`,
    `<p>${escapeHtml(user.name)} has invited you to join <b>${escapeHtml(what)}</b>.</p><p><a href="${inviteUrl}" style="background:${org.brandColor};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Accept invitation</a></p><p style="color:#666;font-size:12px">This link expires in ${INVITE_DAYS} days.</p>`,
  );
  res.status(201).json({ id: invite.id, inviteUrl, emailed, emailConfigured: emailEnabled });
});

orgRouter.delete('/invites/:id', async (req, res) => {
  const user = me(req);
  const invite = await prisma.invite.findFirst({ where: { id: param(req, 'id'), orgId: user.orgId } });
  if (!invite) throw notFound('Invite not found');
  if (invite.role !== 'CLIENT' && !isAdmin(user)) throw forbidden();
  await prisma.invite.delete({ where: { id: invite.id } });
  res.json({ ok: true });
});

orgRouter.patch('/members/:id', requireAdmin, async (req, res) => {
  const user = me(req);
  const { role } = parse(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }), req.body);
  const target = await prisma.user.findFirst({ where: { id: param(req, 'id'), orgId: user.orgId, role: { not: 'CLIENT' }, deactivatedAt: null } });
  if (!target) throw notFound('Member not found');
  if (target.role === 'OWNER') throw forbidden("The owner's role can't be changed");
  const updated = await prisma.user.update({ where: { id: target.id }, data: { role }, select: userPublic });
  res.json(updated);
});

/** Removes a staff member or a client user. */
orgRouter.delete('/members/:id', async (req, res) => {
  const user = me(req);
  const target = await prisma.user.findFirst({ where: { id: param(req, 'id'), orgId: user.orgId, deactivatedAt: null } });
  if (!target) throw notFound('User not found');
  if (target.role === 'OWNER') throw forbidden("The workspace owner can't be removed");
  if (target.id === user.id) throw badRequest("You can't remove yourself");
  if (target.role !== 'CLIENT' && !isAdmin(user)) throw forbidden('Only admins can remove team members');
  // Deactivate rather than delete so their comments/files/history remain. The email is freed up
  // so the person can be re-invited later.
  await prisma.user.update({
    where: { id: target.id },
    data: { deactivatedAt: new Date(), email: `${target.email}#removed-${target.id}` },
  });
  res.json({ ok: true });
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
