import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { parse } from '../lib/http.js';
import { me } from '../middleware/auth.js';
import { invoiceScope, isStaff, projectScope } from '../lib/access.js';
import { invoiceTotal } from './invoices.js';

export const miscRouter = Router();

miscRouter.get('/notifications', async (req, res) => {
  const user = me(req);
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({ items, unread });
});

miscRouter.post('/notifications/read', async (req, res) => {
  const user = me(req);
  const { ids } = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

miscRouter.get('/dashboard', async (req, res) => {
  const user = me(req);
  const pScope = projectScope(user);
  const [projects, awaiting, invoices, activity, upcoming] = await Promise.all([
    prisma.project.groupBy({ by: ['status'], where: pScope, _count: true }),
    prisma.milestone.findMany({
      where: { status: 'AWAITING_APPROVAL', project: pScope },
      include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
      orderBy: { submittedAt: 'asc' },
      take: 10,
    }),
    prisma.invoice.findMany({
      where: { ...invoiceScope(user), status: { in: ['OPEN', 'PAID'] } },
      include: { items: true, client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.activity.findMany({
      where: { project: pScope },
      include: { actor: { select: { id: true, name: true, role: true } }, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.milestone.findMany({
      where: { project: { ...pScope, status: 'ACTIVE' }, status: { not: 'APPROVED' }, dueDate: { not: null } },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 8,
    }),
  ]);

  const open = invoices.filter((i) => i.status === 'OPEN');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const byCurrency = (list: typeof invoices) =>
    list.reduce<Record<string, number>>((acc, i) => {
      acc[i.currency] = (acc[i.currency] ?? 0) + invoiceTotal(i.items);
      return acc;
    }, {});

  res.json({
    projects: {
      active: projects.find((p) => p.status === 'ACTIVE')?._count ?? 0,
      onHold: projects.find((p) => p.status === 'ON_HOLD')?._count ?? 0,
      completed: projects.find((p) => p.status === 'COMPLETED')?._count ?? 0,
    },
    awaitingApproval: awaiting,
    outstanding: byCurrency(open),
    overdueCount: open.filter((i) => i.dueDate && i.dueDate < now).length,
    paidThisMonth: byCurrency(invoices.filter((i) => i.status === 'PAID' && i.paidAt && i.paidAt >= monthStart)),
    openInvoices: open.slice(0, 6).map((i) => ({
      id: i.id,
      number: i.number,
      client: i.client.name,
      currency: i.currency,
      dueDate: i.dueDate,
      total: invoiceTotal(i.items),
    })),
    activity,
    upcoming,
    clientCount: isStaff(user) ? await prisma.client.count({ where: { orgId: user.orgId } }) : undefined,
  });
});
