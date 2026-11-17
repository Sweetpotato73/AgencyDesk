/**
 * Socket.IO real-time layer.
 *
 * Rooms:
 *   user:<id>                 personal notifications
 *   project:<id>:staff        everything in a project (agency staff)
 *   project:<id>:all          client-safe events in a project (staff + client users)
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { User } from '@prisma/client';
import { COOKIE_NAME, readCookie, verifySession } from './auth.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { getAccessibleProject, isStaff } from './access.js';

let io: Server | null = null;

type AuthedSocket = Socket & { data: { user: User } };

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: env.APP_URL, credentials: true },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    const token = readCookie(socket.handshake.headers.cookie, COOKIE_NAME);
    const session = token ? verifySession(token) : null;
    const user = session ? await prisma.user.findUnique({ where: { id: session.sub } }) : null;
    if (!user || user.deactivatedAt) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (raw) => {
    const socket = raw as AuthedSocket;
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    socket.on('project:join', async (projectId: unknown, ack?: (r: { ok: boolean }) => void) => {
      try {
        if (typeof projectId !== 'string') throw new Error('bad id');
        await getAccessibleProject(user, projectId);
        socket.join(`project:${projectId}:all`);
        if (isStaff(user)) socket.join(`project:${projectId}:staff`);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('project:leave', (projectId: unknown) => {
      if (typeof projectId !== 'string') return;
      socket.leave(`project:${projectId}:all`);
      socket.leave(`project:${projectId}:staff`);
    });

    // Lightweight "X is typing…" indicator for discussions & task threads.
    socket.on('typing', (p: { projectId?: unknown; taskId?: unknown }) => {
      if (typeof p?.projectId !== 'string') return;
      const room = `project:${p.projectId}:all`;
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('typing', {
        projectId: p.projectId,
        taskId: typeof p.taskId === 'string' ? p.taskId : null,
        user: { id: user.id, name: user.name },
      });
    });

    prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  });

  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** clientSafe=false limits the event to agency staff (e.g. internal tasks). */
export function emitToProject(projectId: string, event: string, payload: unknown, clientSafe = true) {
  io?.to(`project:${projectId}:${clientSafe ? 'all' : 'staff'}`).emit(event, payload);
}
