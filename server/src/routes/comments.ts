import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { me } from '../middleware/auth.js';
import { getAccessibleProject, getAccessibleTask, isAdmin, projectScope, taskVisibility } from '../lib/access.js';
import { emitToProject } from '../lib/realtime.js';
import { notifyProject } from '../lib/notify.js';

export const commentsRouter = Router();

const commentInclude = { author: { select: { id: true, name: true, role: true } } } as const;
const body = z.string().trim().min(1, 'Message cannot be empty').max(10_000);

/** Comments on internal tasks must never reach client sockets. */
async function isClientSafe(taskId: string | null) {
  if (!taskId) return true;
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { clientVisible: true } });
  return Boolean(t?.clientVisible);
}

commentsRouter.get('/projects/:projectId/comments', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const taskId = typeof req.query.taskId === 'string' && req.query.taskId ? req.query.taskId : null;
  if (taskId) await getAccessibleTask(user, taskId);
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : undefined;
  const limit = 50;
  const rows = await prisma.comment.findMany({
    where: { projectId: project.id, taskId, ...(before && !isNaN(+before) ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: commentInclude,
  });
  res.json({ comments: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
});

commentsRouter.post('/projects/:projectId/comments', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const input = parse(z.object({ body, taskId: z.string().nullable().optional() }), req.body);
  const task = input.taskId ? await getAccessibleTask(user, input.taskId) : null;
  if (task && task.projectId !== project.id) throw notFound('Task not found');

  const comment = await prisma.comment.create({
    data: { projectId: project.id, taskId: task?.id ?? null, authorId: user.id, body: input.body },
    include: commentInclude,
  });
  const clientSafe = task ? task.clientVisible : true;
  emitToProject(project.id, 'comment:new', comment, clientSafe);

  const where = task ? `on “${task.title}”` : `in ${project.name}`;
  await notifyProject(
    project.id,
    user,
    {
      type: 'comment.new',
      title: `${user.name} commented ${where}`,
      body: input.body.length > 140 ? input.body.slice(0, 137) + '…' : input.body,
      link: task ? `/projects/${project.id}?task=${task.id}` : `/projects/${project.id}?tab=discussion`,
    },
    clientSafe ? 'all' : 'staff',
  );
  res.status(201).json(comment);
});

async function ownComment(userId: string, id: string, allowAdmin: boolean, user: Parameters<typeof isAdmin>[0]) {
  const c = await prisma.comment.findFirst({
    where: { id, project: projectScope(user), OR: [{ taskId: null }, { task: taskVisibility(user) }] },
  });
  if (!c) throw notFound('Comment not found');
  if (c.authorId !== userId && !(allowAdmin && isAdmin(user))) throw forbidden('You can only change your own messages');
  return c;
}

commentsRouter.patch('/comments/:id', async (req, res) => {
  const user = me(req);
  const c = await ownComment(user.id, param(req, 'id'), false, user);
  const input = parse(z.object({ body }), req.body);
  const updated = await prisma.comment.update({
    where: { id: c.id },
    data: { body: input.body, editedAt: new Date() },
    include: commentInclude,
  });
  emitToProject(c.projectId, 'comment:updated', updated, await isClientSafe(c.taskId));
  res.json(updated);
});

commentsRouter.delete('/comments/:id', async (req, res) => {
  const user = me(req);
  const c = await ownComment(user.id, param(req, 'id'), true, user);
  await prisma.comment.delete({ where: { id: c.id } });
  emitToProject(c.projectId, 'comment:deleted', { id: c.id, projectId: c.projectId, taskId: c.taskId }, await isClientSafe(c.taskId));
  res.json({ ok: true });
});
