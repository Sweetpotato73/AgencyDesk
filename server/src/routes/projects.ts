import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { optionalDate, userPublic } from '../lib/validators.js';
import { me, requireAdmin, requireStaff } from '../middleware/auth.js';
import { getAccessibleProject, projectScope, taskVisibility } from '../lib/access.js';
import { purgeStoredFiles } from '../lib/files.js';
import { emitToProject } from '../lib/realtime.js';
import { logActivity, notifyProject } from '../lib/notify.js';

export const projectsRouter = Router();

const projectInput = z.object({
  name: z.string().trim().min(1, 'Required').max(160),
  description: z.string().max(10_000).optional(),
  clientId: z.string().min(1, 'Choose a client'),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED']).optional(),
  dueDate: optionalDate,
});

projectsRouter.get('/', async (req, res) => {
  const user = me(req);
  const projects = await prisma.project.findMany({
    where: projectScope(user),
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: {
      client: { select: { id: true, name: true } },
      milestones: { select: { status: true } },
      tasks: { where: taskVisibility(user), select: { status: true } },
    },
  });
  res.json(
    projects.map(({ milestones, tasks, ...p }) => ({
      ...p,
      milestoneCount: milestones.length,
      milestonesApproved: milestones.filter((m) => m.status === 'APPROVED').length,
      awaitingApproval: milestones.filter((m) => m.status === 'AWAITING_APPROVAL').length,
      taskCount: tasks.length,
      tasksDone: tasks.filter((t) => t.status === 'DONE').length,
    })),
  );
});

projectsRouter.post('/', requireStaff, async (req, res) => {
  const user = me(req);
  const body = parse(projectInput, req.body);
  const client = await prisma.client.findFirst({ where: { id: body.clientId, orgId: user.orgId } });
  if (!client) throw notFound('Client not found');
  const project = await prisma.project.create({
    data: {
      orgId: user.orgId,
      clientId: client.id,
      name: body.name,
      description: body.description ?? '',
      status: body.status,
      dueDate: body.dueDate ?? null,
    },
  });
  await logActivity(project.id, user.id, 'created', `created the project`);
  await notifyProject(project.id, user, {
    type: 'project.created',
    title: `New project: ${project.name}`,
    body: `${user.name} started a new project for ${client.name}`,
    link: `/projects/${project.id}`,
  });
  res.status(201).json(project);
});

projectsRouter.get('/:id', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'id'));
  const [full, team] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        client: { select: { id: true, name: true } },
        milestones: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            tasks: { where: taskVisibility(user), select: { status: true } },
            _count: { select: { files: { where: { status: 'READY' } } } },
          },
        },
      },
    }),
    // People on this project: agency staff and the client's portal users.
    prisma.user.findMany({
      where: {
        orgId: project.orgId,
        deactivatedAt: null,
        OR: [{ role: { not: 'CLIENT' } }, { clientId: project.clientId }],
      },
      select: userPublic,
      orderBy: { name: 'asc' },
    }),
  ]);
  const { milestones, ...rest } = full;
  res.json({
    ...rest,
    team,
    milestones: milestones.map(({ tasks, _count, ...m }) => ({
      ...m,
      taskCount: tasks.length,
      tasksDone: tasks.filter((t) => t.status === 'DONE').length,
      fileCount: _count.files,
    })),
  });
});

projectsRouter.patch('/:id', requireStaff, async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'id'));
  const body = parse(projectInput.omit({ clientId: true }).partial(), req.body);
  const updated = await prisma.project.update({ where: { id: project.id }, data: body });
  if (body.status && body.status !== project.status) {
    await logActivity(project.id, user.id, 'status', `marked the project as ${body.status.replace('_', ' ').toLowerCase()}`);
    if (body.status === 'COMPLETED') {
      await notifyProject(project.id, user, {
        type: 'project.completed',
        title: `${project.name} is complete 🎉`,
        link: `/projects/${project.id}`,
      });
    }
  }
  emitToProject(project.id, 'project:changed', { projectId: project.id });
  res.json(updated);
});

projectsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const project = await getAccessibleProject(me(req), param(req, 'id'));
  await purgeStoredFiles({ projectId: project.id }, () => prisma.project.delete({ where: { id: project.id } }));
  res.json({ ok: true });
});

projectsRouter.get('/:id/activity', async (req, res) => {
  const user = me(req);
  const project = await getAccessibleProject(user, param(req, 'id'));
  const items = await prisma.activity.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { id: true, name: true, role: true } } },
  });
  res.json(items);
});

