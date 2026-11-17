import type { User } from '@prisma/client';
import { prisma } from './db.js';
import { emitToUser } from './realtime.js';
import { projectAudience } from './access.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** Persist a notification for each recipient and push it over WebSocket. */
export async function notify(userIds: string[], n: NotificationInput) {
  const unique = [...new Set(userIds)];
  await Promise.all(
    unique.map(async (userId) => {
      const row = await prisma.notification.create({
        data: { userId, type: n.type, title: n.title, body: n.body ?? '', link: n.link ?? '' },
      });
      emitToUser(userId, 'notification', row);
    }),
  );
}

/**
 * Notify everyone involved in a project except the actor.
 * `audience` picks who: 'all', 'staff' (agency only) or 'clients' (client users only).
 */
export async function notifyProject(
  projectId: string,
  actor: User,
  n: NotificationInput,
  audience: 'all' | 'staff' | 'clients' = 'all',
) {
  const { staff, clients } = await projectAudience(projectId);
  const ids = audience === 'staff' ? staff : audience === 'clients' ? clients : [...staff, ...clients];
  await notify(ids.filter((id) => id !== actor.id), n);
}

export async function logActivity(projectId: string, actorId: string, verb: string, summary: string) {
  await prisma.activity.create({ data: { projectId, actorId, verb, summary } });
}
