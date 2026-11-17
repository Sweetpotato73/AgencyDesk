import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { connectSocket } from './socket';
import type { Comment, Notification } from './types';

type CommentsPage = { comments: Comment[]; hasMore: boolean };
type CommentsData = { pages: CommentsPage[]; pageParams: unknown[] };

/** Patches the cached (paginated) thread; page 0 holds the newest messages. */
function patchComments(
  qc: QueryClient,
  c: { projectId: string; taskId: string | null },
  fn: (list: Comment[], isNewestPage: boolean) => Comment[],
) {
  qc.setQueryData<CommentsData>(['comments', c.projectId, c.taskId ?? 'general'], (old) =>
    old ? { ...old, pages: old.pages.map((p, i) => ({ ...p, comments: fn(p.comments, i === 0) })) } : old,
  );
}

/** Global listeners: personal notifications and invoice updates. */
export function useGlobalRealtime(onNotification: (n: Notification) => void) {
  const qc = useQueryClient();
  const cb = useRef(onNotification);
  cb.current = onNotification;

  useEffect(() => {
    const socket = connectSocket();
    const onNotif = (n: Notification) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      cb.current(n);
    };
    const onInvoice = ({ invoiceId }: { invoiceId: string }) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    };
    const onReconnect = () => qc.invalidateQueries();
    socket.on('notification', onNotif);
    socket.on('invoice:changed', onInvoice);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('notification', onNotif);
      socket.off('invoice:changed', onInvoice);
      socket.io.off('reconnect', onReconnect);
    };
  }, [qc]);
}

/** Joins a project's room and keeps all of its cached data live. */
export function useProjectRealtime(projectId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const socket = connectSocket();
    const join = () => socket.emit('project:join', projectId);
    join();
    socket.on('connect', join);

    const mine = (p: { projectId?: string }) => p?.projectId === projectId;
    const inv = (...keys: unknown[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

    const handlers: Record<string, (p: any) => void> = {
      'project:changed': (p) => mine(p) && inv(['project', projectId], ['projects'], ['activity', projectId]),
      'milestone:changed': (p) => mine(p) && inv(['project', projectId], ['projects'], ['activity', projectId], ['dashboard']),
      'task:changed': (p) => mine(p) && inv(['tasks', projectId], ['task', p.taskId], ['project', projectId], ['activity', projectId]),
      'file:changed': (p) => {
        if (!mine(p)) return;
        inv(['files', projectId], ['project', projectId], ['activity', projectId], ['tasks', projectId]);
        if (p.taskId) inv(['task', p.taskId]);
      },
      'comment:new': (c: Comment) => {
        if (!mine(c)) return;
        patchComments(qc, c, (list, newest) => (!newest || list.some((x) => x.id === c.id) ? list : [...list, c]));
        if (c.taskId) inv(['tasks', projectId]);
      },
      'comment:updated': (c: Comment) => mine(c) && patchComments(qc, c, (list) => list.map((x) => (x.id === c.id ? c : x))),
      'comment:deleted': (c: { id: string; projectId: string; taskId: string | null }) =>
        mine(c) && patchComments(qc, c, (list) => list.filter((x) => x.id !== c.id)),
    };
    for (const [e, h] of Object.entries(handlers)) socket.on(e, h);

    return () => {
      socket.emit('project:leave', projectId);
      socket.off('connect', join);
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
    };
  }, [projectId, qc]);
}

/** "Alex is typing…" for a discussion thread. */
export function useTyping(projectId: string, taskId: string | null, myId: string) {
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const lastSent = useRef(0);

  useEffect(() => {
    const socket = connectSocket();
    const onTyping = (p: { projectId: string; taskId: string | null; user: { id: string; name: string } }) => {
      if (p.projectId !== projectId || (p.taskId ?? null) !== taskId || p.user.id === myId) return;
      setTypers((t) => ({ ...t, [p.user.id]: { name: p.user.name, until: Date.now() + 3500 } }));
    };
    const onComment = (c: Comment) =>
      setTypers((t) => {
        if (!t[c.author.id]) return t;
        const { [c.author.id]: _gone, ...rest } = t;
        return rest;
      });
    socket.on('typing', onTyping);
    socket.on('comment:new', onComment);
    const timer = setInterval(() => {
      setTypers((t) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(t).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => {
      socket.off('typing', onTyping);
      socket.off('comment:new', onComment);
      clearInterval(timer);
    };
  }, [projectId, taskId, myId]);

  const notifyTyping = () => {
    if (Date.now() - lastSent.current < 2000) return;
    lastSent.current = Date.now();
    connectSocket().emit('typing', { projectId, taskId });
  };

  return { typing: Object.values(typers).map((t) => t.name), notifyTyping };
}
