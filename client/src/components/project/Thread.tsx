import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Send, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime, relative } from '../../lib/format';
import { useTyping } from '../../lib/realtime';
import type { Comment } from '../../lib/types';
import { useMe } from '../../context/session';
import { Avatar, Badge, Button, EmptyState, Spinner, cx, useFeedback } from '../ui';

type Page = { comments: Comment[]; hasMore: boolean };

/** Real-time message thread for a project (taskId=null) or a single task. */
export function Thread({ projectId, taskId = null, className }: { projectId: string; taskId?: string | null; className?: string }) {
  const qc = useQueryClient();
  const { user, isAdmin } = useMe();
  const { toast, confirm } = useFeedback();
  const key = ['comments', projectId, taskId ?? 'general'];
  const scroller = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const { typing, notifyTyping } = useTyping(projectId, taskId, user.id);

  // First page lives under `key` (so realtime updates can patch it); older pages are fetched on demand.
  const latest = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<Page>(`/projects/${projectId}/comments?${new URLSearchParams({ ...(taskId ? { taskId } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    getNextPageParam: (last) => (last.hasMore ? last.comments[0]?.createdAt ?? null : null),
  });

  // pages[0] is the newest batch; render oldest → newest.
  const comments = (latest.data?.pages ?? [])
    .slice()
    .reverse()
    .flatMap((p) => p.comments);

  const atBottom = useRef(true);
  const prevCount = useRef(0);
  const restore = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current) {
      // Older messages were prepended: keep the same message under the user's eyes.
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (comments.length > prevCount.current && (atBottom.current || prevCount.current === 0)) {
      el.scrollTop = el.scrollHeight;
    }
    prevCount.current = comments.length;
  }, [comments.length]);

  const loadOlder = () => {
    const el = scroller.current;
    if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop };
    latest.fetchNextPage();
  };

  const send = useMutation({
    mutationFn: (text: string) => api.post<Comment>(`/projects/${projectId}/comments`, { body: text, taskId }),
    onSuccess: (c) => {
      appendLocal(c);
      atBottom.current = true;
    },
    onError: (e, text) => {
      setBody(text);
      toast(errorMessage(e), 'error');
    },
  });

  function appendLocal(c: Comment) {
    qc.setQueryData<{ pages: Page[]; pageParams: unknown[] }>(key, (old) => {
      if (!old) return old;
      const [first, ...rest] = old.pages;
      if (!first || first.comments.some((x) => x.id === c.id)) return old;
      return { ...old, pages: [{ ...first, comments: [...first.comments, c] }, ...rest] };
    });
  }

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.patch<Comment>(`/comments/${id}`, { body }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = () => {
    const text = body.trim();
    if (!text || send.isPending) return;
    setBody('');
    send.mutate(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  useEffect(() => setBody(''), [projectId, taskId]);

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2"
      >
        {latest.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : latest.error ? (
          <p className="py-6 text-center text-sm text-red-600">{errorMessage(latest.error)}</p>
        ) : comments.length === 0 ? (
          <EmptyState icon={<MessageSquare className="size-5" />} title="No messages yet" description="Start the conversation — everyone on the project gets notified instantly." />
        ) : (
          <>
            {latest.hasNextPage && (
              <div className="text-center">
                <Button variant="ghost" size="sm" loading={latest.isFetchingNextPage} onClick={loadOlder}>
                  Load older messages
                </Button>
              </div>
            )}
            {comments.map((c) => {
              const mine = c.author.id === user.id;
              return (
                <div key={c.id} className="group flex gap-3">
                  <Avatar name={c.author.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-slate-900">{c.author.name}</span>
                      {c.author.role === 'CLIENT' ? <Badge tone="brand">Client</Badge> : null}
                      <span className="text-xs text-slate-400" title={dateTime(c.createdAt)}>
                        {relative(c.createdAt)}
                        {c.editedAt && ' · edited'}
                      </span>
                      <span className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                        {mine && (
                          <button onClick={() => setEditing({ id: c.id, body: c.body })} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit">
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {(mine || isAdmin) && (
                          <button
                            onClick={async () => (await confirm({ title: 'Delete message?', confirmLabel: 'Delete', danger: true })) && remove.mutate(c.id)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </span>
                    </div>
                    {editing?.id === c.id ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          autoFocus
                          value={editing.body}
                          onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                          className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand"
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" loading={update.isPending} onClick={() => update.mutate(editing)} disabled={!editing.body.trim()}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{c.body}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="h-5 px-1 text-xs text-slate-400">{typing.length > 0 && `${typing.join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`}</div>
      <div className="flex items-end gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand">
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            notifyTyping();
          }}
          onKeyDown={onKey}
          rows={1}
          placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-0"
          style={{ fieldSizing: 'content' } as CSSProperties}
        />
        <Button onClick={submit} disabled={!body.trim()} loading={send.isPending} aria-label="Send" icon={<Send className="size-4" />} />
      </div>
    </div>
  );
}
