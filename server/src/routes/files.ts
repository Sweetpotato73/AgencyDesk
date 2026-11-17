import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { me } from '../middleware/auth.js';
import {
  getAccessibleMilestone,
  getAccessibleProject,
  getAccessibleTask,
  isStaff,
  projectScope,
  taskVisibility,
} from '../lib/access.js';
import { MAX_UPLOAD_BYTES, canPreviewInline, storage } from '../lib/storage.js';
import { emitToProject } from '../lib/realtime.js';
import { logActivity, notifyProject } from '../lib/notify.js';
import { filePublic } from '../lib/files.js';

export const filesRouter = Router();

/** Visible files: READY, in an accessible project, and not attached to an internal task (for clients). */
function fileScope(user: Parameters<typeof projectScope>[0]): Prisma.FileWhereInput {
  return {
    status: 'READY',
    project: projectScope(user),
    ...(isStaff(user) ? {} : { OR: [{ taskId: null }, { task: taskVisibility(user) }] }),
  };
}

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

filesRouter.get('/projects/:projectId/files', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const where: Prisma.FileWhereInput = { ...fileScope(user), projectId: project.id };
  if (typeof req.query.taskId === 'string') where.taskId = req.query.taskId;
  if (typeof req.query.milestoneId === 'string') where.milestoneId = req.query.milestoneId;
  const files = await prisma.file.findMany({
    where,
    select: { ...filePublic, task: { select: { id: true, title: true } }, milestone: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(files);
});

/** Step 1: register the file and get a presigned upload target. */
filesRouter.post('/projects/:projectId/files', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'projectId'));
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(255),
      size: z
        .number()
        .int()
        .min(0)
        .max(MAX_UPLOAD_BYTES, `Files must be smaller than ${formatBytes(MAX_UPLOAD_BYTES)}`),
      mimeType: z.string().max(200).optional(),
      taskId: z.string().nullable().optional(),
      milestoneId: z.string().nullable().optional(),
    }),
    req.body,
  );
  if (body.taskId) {
    const t = await getAccessibleTask(user, body.taskId);
    if (t.projectId !== project.id) throw notFound('Task not found');
  }
  if (body.milestoneId) {
    const m = await getAccessibleMilestone(user, body.milestoneId);
    if (m.projectId !== project.id) throw notFound('Milestone not found');
  }
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(body.mimeType ?? '') ? body.mimeType! : 'application/octet-stream';
  const safeName = body.name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_');
  const storageKey = `orgs/${project.orgId}/projects/${project.id}/${crypto.randomUUID()}`;

  const file = await prisma.file.create({
    data: {
      orgId: project.orgId,
      projectId: project.id,
      taskId: body.taskId ?? null,
      milestoneId: body.milestoneId ?? null,
      uploaderId: user.id,
      name: safeName,
      size: body.size,
      mimeType,
      storageKey,
    },
  });
  const upload = await storage.createUploadUrl(storageKey, mimeType);
  res.status(201).json({ fileId: file.id, upload });
});

/** Step 2: browser finished the PUT — verify the object exists, then publish it. */
filesRouter.post('/files/:id/complete', async (req, res) => {
  const user = me(req);
  const file = await prisma.file.findFirst({
    where: { id: param(req, 'id'), uploaderId: user.id, status: 'PENDING' },
    include: { project: { select: { name: true } }, task: { select: { title: true, clientVisible: true } }, milestone: { select: { title: true } } },
  });
  if (!file) throw notFound('Upload not found');
  const stat = await storage.stat(file.storageKey);
  if (!stat) throw badRequest('The upload did not reach storage — please try again');
  if (stat.size > MAX_UPLOAD_BYTES) {
    await storage.remove(file.storageKey);
    await prisma.file.delete({ where: { id: file.id } });
    throw badRequest(`Files must be smaller than ${formatBytes(MAX_UPLOAD_BYTES)}`);
  }
  const ready = await prisma.file.update({
    where: { id: file.id },
    data: { status: 'READY', size: stat.size },
    select: filePublic,
  });

  const clientSafe = file.task ? file.task.clientVisible : true;
  emitToProject(file.projectId, 'file:changed', { projectId: file.projectId, fileId: file.id, taskId: file.taskId }, clientSafe);
  const where = file.task ? ` to “${file.task.title}”` : file.milestone ? ` to “${file.milestone.title}”` : '';
  if (clientSafe) await logActivity(file.projectId, user.id, 'uploaded', `uploaded ${file.name}${where}`);
  await notifyProject(
    file.projectId,
    user,
    {
      type: 'file.uploaded',
      title: `${user.name} uploaded ${file.name}`,
      body: `${formatBytes(stat.size)} · ${file.project.name}`,
      link: `/projects/${file.projectId}?tab=files`,
    },
    clientSafe ? 'all' : 'staff',
  );
  res.json(ready);
});

/** Returns a short-lived signed URL. ?inline=1 previews safe types in the browser. */
filesRouter.get('/files/:id/url', async (req, res) => {
  const user = me(req);
  const file = await prisma.file.findFirst({ where: { id: param(req, 'id'), ...fileScope(user) } });
  if (!file) throw notFound('File not found');
  const inline = req.query.inline === '1' && canPreviewInline(file.mimeType);
  const url = await storage.createDownloadUrl(file.storageKey, file.name, { inline, contentType: file.mimeType });
  res.json({ url, inline });
});

filesRouter.delete('/files/:id', async (req, res) => {
  const user = me(req);
  const file = await prisma.file.findFirst({ where: { id: param(req, 'id'), ...fileScope(user) } });
  if (!file) throw notFound('File not found');
  if (file.uploaderId !== user.id && !isStaff(user)) throw forbidden('You can only delete files you uploaded');
  await prisma.file.delete({ where: { id: file.id } });
  await storage.remove(file.storageKey).catch((e) => console.error('storage remove failed', e));
  const clientSafe = file.taskId ? Boolean((await prisma.task.findUnique({ where: { id: file.taskId } }))?.clientVisible) : true;
  emitToProject(file.projectId, 'file:changed', { projectId: file.projectId, fileId: file.id, taskId: file.taskId }, clientSafe);
  res.json({ ok: true });
});
