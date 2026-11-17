import { Router } from 'express';
import { z } from 'zod';
import type { Milestone, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { optionalDate } from '../lib/validators.js';
import { me, requireStaff } from '../middleware/auth.js';
import { getAccessibleMilestone, getAccessibleProject, isAdmin } from '../lib/access.js';
import { emitToProject } from '../lib/realtime.js';
import { logActivity, notifyProject } from '../lib/notify.js';
import { purgeStoredFiles } from '../lib/files.js';

export const milestonesRouter = Router();

const milestoneInput = z.object({
  title: z.string().trim().min(1, 'Required').max(200),
  description: z.string().max(10_000).optional(),
  dueDate: optionalDate,
  // Approval states are only reachable through the submit/approve/request-changes actions.
  status: z.enum(['PENDING', 'IN_PROGRESS']).optional(),
});

const changed = (m: Milestone) => emitToProject(m.projectId, 'milestone:changed', { projectId: m.projectId, milestoneId: m.id });

milestonesRouter.post('/projects/:projectId/milestones', requireStaff, async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const body = parse(milestoneInput, req.body);
  const last = await prisma.milestone.aggregate({ where: { projectId: project.id }, _max: { position: true } });
  const m = await prisma.milestone.create({
    data: {
      projectId: project.id,
      title: body.title,
      description: body.description ?? '',
      dueDate: body.dueDate ?? null,
      status: body.status,
      position: (last._max.position ?? -1) + 1,
    },
  });
  await logActivity(project.id, user.id, 'milestone', `added milestone “${m.title}”`);
  changed(m);
  res.status(201).json(m);
});

milestonesRouter.patch('/milestones/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const m = await getAccessibleMilestone(user, param(req, 'id'));
  const body = parse(milestoneInput.partial().extend({ position: z.number().int().min(0).optional() }), req.body);
  // Reopening an approved/submitted milestone clears the old decision. Coming from "changes requested"
  // we keep the client's note so the team can still see what needs to change.
  const reopening = body.status && (m.status === 'APPROVED' || m.status === 'AWAITING_APPROVAL');
  const updated = await prisma.milestone.update({
    where: { id: m.id },
    data: {
      ...body,
      ...(reopening ? { submittedAt: null, decidedAt: null, decidedById: null, decisionNote: null } : {}),
    },
  });
  changed(updated);
  res.json(updated);
});

/** Move a milestone up/down by swapping positions with its neighbour. */
milestonesRouter.post('/milestones/:id/move', requireStaff, async (req, res) => {
  const user = me(req);
  const m = await getAccessibleMilestone(user, param(req, 'id'));
  const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body);
  const list = await prisma.milestone.findMany({
    where: { projectId: m.projectId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const i = list.findIndex((x) => x.id === m.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j]!, list[i]!];
    await prisma.$transaction(list.map((x, pos) => prisma.milestone.update({ where: { id: x.id }, data: { position: pos } })));
  }
  changed(m);
  res.json({ ok: true });
});

milestonesRouter.delete('/milestones/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const m = await getAccessibleMilestone(user, param(req, 'id'));
  await purgeStoredFiles({ milestoneId: m.id, taskId: null }, () =>
    prisma.$transaction([
      // Files attached directly to the milestone go with it; tasks are kept (milestoneId → null).
      prisma.file.deleteMany({ where: { milestoneId: m.id, taskId: null } }),
      prisma.milestone.delete({ where: { id: m.id } }),
    ]),
  );
  changed(m);
  res.json({ ok: true });
});

milestonesRouter.post('/milestones/:id/submit', requireStaff, async (req, res) => {
  const user = me(req);
  const m = await getAccessibleMilestone(user, param(req, 'id'));
  if (m.status === 'APPROVED') throw badRequest('This milestone is already approved');
  const { note } = parse(z.object({ note: z.string().max(2000).optional() }), req.body ?? {});
  const updated = await prisma.milestone.update({
    where: { id: m.id },
    data: { status: 'AWAITING_APPROVAL', submittedAt: new Date(), decidedAt: null, decidedById: null, decisionNote: note || null },
  });
  await logActivity(m.projectId, user.id, 'submitted', `submitted “${m.title}” for approval`);
  await notifyProject(
    m.projectId,
    user,
    {
      type: 'milestone.submitted',
      title: `Approval needed: ${m.title}`,
      body: note || `${user.name} submitted this milestone for your review.`,
      link: `/projects/${m.projectId}?milestone=${m.id}`,
    },
    'clients',
  );
  changed(updated);
  res.json(updated);
});

async function decide(user: User, milestoneId: string, approve: boolean, note?: string) {
  const m = await getAccessibleMilestone(user, milestoneId);
  // Clients decide on their own milestones; agency admins may record a decision on their behalf.
  if (user.role !== 'CLIENT' && !isAdmin(user)) throw forbidden('Only the client (or an admin) can approve milestones');
  if (m.status !== 'AWAITING_APPROVAL') throw badRequest('This milestone is not awaiting approval');
  if (!approve && !note?.trim()) throw badRequest('Please describe the changes you need', { note: 'Required' });
  const updated = await prisma.milestone.update({
    where: { id: m.id },
    data: {
      status: approve ? 'APPROVED' : 'CHANGES_REQUESTED',
      decidedAt: new Date(),
      decidedById: user.id,
      decisionNote: note?.trim() || null,
    },
  });
  await logActivity(
    m.projectId,
    user.id,
    approve ? 'approved' : 'changes',
    approve ? `approved “${m.title}”` : `requested changes on “${m.title}”`,
  );
  await notifyProject(
    m.projectId,
    user,
    {
      type: approve ? 'milestone.approved' : 'milestone.changes_requested',
      title: approve ? `✅ ${m.title} approved` : `Changes requested: ${m.title}`,
      body: note?.trim() || `${user.name} ${approve ? 'approved' : 'requested changes on'} this milestone.`,
      link: `/projects/${m.projectId}?milestone=${m.id}`,
    },
    'all',
  );
  changed(updated);
  return updated;
}

milestonesRouter.post('/milestones/:id/approve', async (req, res) => {
  const { note } = parse(z.object({ note: z.string().max(2000).optional() }), req.body ?? {});
  res.json(await decide(me(req), param(req, 'id'), true, note));
});

milestonesRouter.post('/milestones/:id/request-changes', async (req, res) => {
  const { note } = parse(z.object({ note: z.string().max(2000) }), req.body ?? {});
  res.json(await decide(me(req), param(req, 'id'), false, note));
});
