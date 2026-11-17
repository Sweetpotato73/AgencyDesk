import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { userPublic } from '../lib/validators.js';
import { me, requireAdmin, requireStaff } from '../middleware/auth.js';
import { invoiceTotal } from './invoices.js';
import { purgeStoredFiles } from '../lib/files.js';

export const clientsRouter = Router();
clientsRouter.use(requireStaff);

const clientInput = z.object({
  name: z.string().trim().min(1, 'Required').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address')
    .optional(),
  phone: z.string().trim().max(40).optional(),
});

clientsRouter.get('/', async (req, res) => {
  const orgId = me(req).orgId;
  const clients = await prisma.client.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { projects: true, users: { where: { deactivatedAt: null } } } },
      invoices: { where: { status: 'OPEN' }, include: { items: true } },
    },
  });
  res.json(
    clients.map(({ invoices, ...c }) => ({
      ...c,
      outstanding: invoices.reduce((sum, inv) => sum + invoiceTotal(inv.items), 0),
    })),
  );
});

clientsRouter.post('/', async (req, res) => {
  const body = parse(clientInput, req.body);
  const client = await prisma.client.create({
    data: { orgId: me(req).orgId, name: body.name, email: body.email || null, phone: body.phone || null },
  });
  res.status(201).json(client);
});

async function getClient(orgId: string, id: string) {
  const client = await prisma.client.findFirst({ where: { id, orgId } });
  if (!client) throw notFound('Client not found');
  return client;
}

clientsRouter.get('/:id', async (req, res) => {
  const orgId = me(req).orgId;
  const client = await getClient(orgId, param(req, 'id'));
  const [users, invites, projects] = await Promise.all([
    prisma.user.findMany({
      where: { clientId: client.id, deactivatedAt: null },
      select: { ...userPublic, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invite.findMany({
      where: { clientId: client.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { clientId: client.id },
      select: { id: true, name: true, status: true, dueDate: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({ ...client, users, invites, projects });
});

clientsRouter.patch('/:id', async (req, res) => {
  const client = await getClient(me(req).orgId, param(req, 'id'));
  const body = parse(clientInput.partial(), req.body);
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      name: body.name,
      email: body.email === undefined ? undefined : body.email || null,
      phone: body.phone === undefined ? undefined : body.phone || null,
    },
  });
  res.json(updated);
});

/** Deletes the client along with its projects, invoices and portal users. Admin only. */
clientsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const client = await getClient(me(req).orgId, param(req, 'id'));
  await purgeStoredFiles({ project: { clientId: client.id } }, () => prisma.client.delete({ where: { id: client.id } }));
  res.json({ ok: true });
});
