import { Router } from 'express';
import { z } from 'zod';
import type { Task } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { optionalDate, userPublic } from '../lib/validators.js';
import { me, requireStaff } from '../middleware/auth.js';
import { getAccessibleProject, getAccessibleTask, taskVisibility } from '../lib/access.js';
import { emitToProject } from '../lib/realtime.js';
import { logActivity, notify } from '../lib/notify.js';
import { filePublic, purgeStoredFiles } from '../lib/files.js';

export const tasksRouter = Router();

const STATUS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
const taskInput = z.object({
  title: z.string().trim().min(1, 'Required').max(240),
  description: z.string().max(20_000).optional(),
  status: z.enum(STATUS).optional(),
  assigneeId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  dueDate: optionalDate,
  clientVisible: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const taskInclude = {
  assignee: { select: userPublic },
  milestone: { select: { id: true, title: true } },
  _count: { select: { comments: true, files: { where: { status: 'READY' as const } } } },
};

/** Broadcast a task change; internal tasks are only announced to staff. */
function changed(before: Pick<Task, 'clientVisible'> | null, after: Task) {
  const clientSafe = after.clientVisible || Boolean(before?.clientVisible);
  emitToProject(after.projectId, 'task:changed', { projectId: after.projectId, taskId: after.id }, clientSafe);
}

async function validateRefs(projectId: string, orgId: string, assigneeId?: string | null, milestoneId?: string | null) {
  if (assigneeId) {
    const ok = await prisma.user.findFirst({ where: { id: assigneeId, orgId, role: { not: 'CLIENT' }, deactivatedAt: null } });
    if (!ok) throw badRequest('Assignee must be a member of your team');
  }
  if (milestoneId) {
    const ok = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!ok) throw badRequest('Milestone does not belong to this project');
  }
}

tasksRouter.get('/projects/:projectId/tasks', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id, ...taskVisibility(user) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: taskInclude,
  });
  res.json(tasks);
});

tasksRouter.post('/projects/:projectId/tasks', requireStaff, async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const body = parse(taskInput, req.body);
  await validateRefs(project.id, user.orgId, body.assigneeId, body.milestoneId);
  const last = await prisma.task.aggregate({ where: { projectId: project.id }, _max: { position: true } });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      title: body.title,
      description: body.description ?? '',
      status: body.status,
      assigneeId: body.assigneeId ?? null,
      milestoneId: body.milestoneId ?? null,
      dueDate: body.dueDate ?? null,
      clientVisible: body.clientVisible ?? true,
      position: (last._max.position ?? -1) + 1,
    },
    include: taskInclude,
  });
  if (task.clientVisible) await logActivity(project.id, user.id, 'task', `created task “${task.title}”`);
  if (task.assigneeId && task.assigneeId !== user.id) {
    await notify([task.assigneeId], {
      type: 'task.assigned',
      title: `You were assigned: ${task.title}`,
      body: `${user.name} assigned you a task in ${project.name}`,
      link: `/projects/${project.id}?task=${task.id}`,
    });
  }
  changed(null, task);
  res.status(201).json(task);
});

tasksRouter.get('/tasks/:id', async (req, res) => {
  const user = me(req);
  const t = await getAccessibleTask(user, param(req, 'id'));
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: t.id },
    include: {
      ...taskInclude,
      files: { where: { status: 'READY' }, select: filePublic, orderBy: { createdAt: 'desc' } },
    },
  });
  res.json(task);
});

tasksRouter.patch('/tasks/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const before = await getAccessibleTask(user, param(req, 'id'));
  const body = parse(taskInput.partial(), req.body);
  await validateRefs(before.projectId, user.orgId, body.assigneeId, body.milestoneId);
  const task = await prisma.task.update({ where: { id: before.id }, data: body, include: taskInclude });

  if (body.status && body.status !== before.status && task.clientVisible) {
    const label = { TODO: 'to do', IN_PROGRESS: 'in progress', IN_REVIEW: 'in review', DONE: 'done' }[body.status];
    await logActivity(task.projectId, user.id, 'task', `moved “${task.title}” to ${label}`);
  }
  if (body.assigneeId && body.assigneeId !== before.assigneeId && body.assigneeId !== user.id) {
    await notify([body.assigneeId], {
      type: 'task.assigned',
      title: `You were assigned: ${task.title}`,
      body: `${user.name} assigned you a task`,
      link: `/projects/${task.projectId}?task=${task.id}`,
    });
  }
  changed(before, task);
  res.json(task);
});

tasksRouter.delete('/tasks/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const task = await getAccessibleTask(user, param(req, 'id'));
  await purgeStoredFiles({ taskId: task.id }, () =>
    prisma.$transaction([prisma.file.deleteMany({ where: { taskId: task.id } }), prisma.task.delete({ where: { id: task.id } })]),
  );
  changed(task, task);
  res.json({ ok: true });
});
