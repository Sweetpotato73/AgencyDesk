import type { Prisma, User } from '@prisma/client';
import { prisma } from './db.js';
import { forbidden, notFound } from './errors.js';

export const isStaff = (u: User) => u.role !== 'CLIENT';
export const isAdmin = (u: User) => u.role === 'OWNER' || u.role === 'ADMIN';

/** Prisma filter for the projects a user may see. */
export function projectScope(u: User): Prisma.ProjectWhereInput {
  if (isStaff(u)) return { orgId: u.orgId };
  return { orgId: u.orgId, clientId: u.clientId ?? '__none__' };
}

/** Prisma filter for tasks visible to the user inside an accessible project. */
export function taskVisibility(u: User): Prisma.TaskWhereInput {
  return isStaff(u) ? {} : { clientVisible: true };
}

export async function getAccessibleProject(u: User, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectScope(u) } });
  if (!project) throw notFound('Project not found');
  return project;
}

export async function getAccessibleTask(u: User, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: projectScope(u), ...taskVisibility(u) },
  });
  if (!task) throw notFound('Task not found');
  return task;
}

export async function getAccessibleMilestone(u: User, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, project: projectScope(u) } });
  if (!m) throw notFound('Milestone not found');
  return m;
}

export function invoiceScope(u: User): Prisma.InvoiceWhereInput {
  if (isStaff(u)) return { orgId: u.orgId };
  // Clients never see drafts.
  return { orgId: u.orgId, clientId: u.clientId ?? '__none__', status: { not: 'DRAFT' } };
}

/** User ids that should be notified about activity in a project (all staff + the client's users). */
export async function projectAudience(projectId: string): Promise<{ staff: string[]; clients: string[] }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true, clientId: true } });
  if (!project) return { staff: [], clients: [] };
  const users = await prisma.user.findMany({
    where: {
      orgId: project.orgId,
      deactivatedAt: null,
      OR: [{ role: { not: 'CLIENT' } }, { clientId: project.clientId }],
    },
    select: { id: true, role: true },
  });
  return {
    staff: users.filter((x) => x.role !== 'CLIENT').map((x) => x.id),
    clients: users.filter((x) => x.role === 'CLIENT').map((x) => x.id),
  };
}

export function assertSameOrg(u: User, orgId: string) {
  if (u.orgId !== orgId) throw forbidden();
}
