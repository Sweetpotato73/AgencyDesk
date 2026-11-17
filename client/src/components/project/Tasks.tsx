import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, EyeOff, ListTodo, MessageSquare, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { date, inputDate, isOverdue } from '../../lib/format';
import type { Project, Task, TaskDetail, TaskStatus } from '../../lib/types';
import { useMe } from '../../context/session';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Spinner, Textarea, cx, taskStatus, useFeedback } from '../ui';
import { Dropzone, FileList } from './Files';
import { Thread } from './Thread';

const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

function invalidateTask(qc: ReturnType<typeof useQueryClient>, projectId: string, taskId?: string) {
  qc.invalidateQueries({ queryKey: ['tasks', projectId] });
  qc.invalidateQueries({ queryKey: ['project', projectId] });
  qc.invalidateQueries({ queryKey: ['projects'] });
  if (taskId) qc.invalidateQueries({ queryKey: ['task', taskId] });
}

function TaskFormModal({ project, initialStatus, onClose }: { project: Project; initialStatus: TaskStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const staff = project.team.filter((u) => u.role !== 'CLIENT');
  const [v, setV] = useState({ title: '', description: '', assigneeId: '', milestoneId: '', dueDate: '', status: initialStatus, clientVisible: true });
  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${project.id}/tasks`, {
        ...v,
        assigneeId: v.assigneeId || null,
        milestoneId: v.milestoneId || null,
        dueDate: v.dueDate || null,
      }),
    onSuccess: () => {
      invalidateTask(qc, project.id);
      toast('Task created');
      onClose();
    },
  });
  const fields = create.error instanceof ApiError ? (create.error.details ?? {}) : {};
  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={create.isPending}>
            Create task
          </Button>
        </>
      }
    >
      <form
        id="task-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {create.error && !Object.keys(fields).length && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(create.error)}</p>}
        <Input label="Title" required autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} error={fields.title} />
        <Textarea label="Description" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TaskStatus })}>
            {COLUMNS.map((s) => (
              <option key={s} value={s}>
                {taskStatus[s].label}
              </option>
            ))}
          </Select>
          <Select label="Assignee" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select label="Milestone" value={v.milestoneId} onChange={(e) => setV({ ...v, milestoneId: e.target.value })}>
            <option value="">None</option>
            {project.milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
          <Input label="Due date" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        </div>
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 rounded accent-[var(--brand)]" checked={!v.clientVisible} onChange={(e) => setV({ ...v, clientVisible: !e.target.checked })} />
          <span>
            <span className="font-medium">Internal task</span>
            <span className="block text-slate-500">Hidden from the client, including its comments and files.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

export function TaskDrawer({ taskId, project, onClose }: { taskId: string; project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const { isStaff } = useMe();
  const { toast, confirm } = useFeedback();
  const { data: task, isLoading, error } = useQuery({ queryKey: ['task', taskId], queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`) });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const staff = project.team.filter((u) => u.role !== 'CLIENT');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDesc(task.description);
    }
  }, [task?.id, task?.title, task?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = useMutation({
    mutationFn: (data: Partial<Task>) => api.patch<Task>(`/tasks/${taskId}`, data),
    onSuccess: () => invalidateTask(qc, project.id, taskId),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/tasks/${taskId}`),
    onSuccess: () => {
      invalidateTask(qc, project.id);
      toast('Task deleted');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="animate-fade-in absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="animate-slide-in relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ListTodo className="size-4" /> Task
            {task && !task.clientVisible && (
              <Badge tone="slate">
                <EyeOff className="size-3" /> Internal
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isStaff && task && (
              <button
                onClick={async () => (await confirm({ title: 'Delete task?', message: 'Its comments and files will be deleted too.', confirmLabel: 'Delete', danger: true })) && remove.mutate()}
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Delete task"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : error || !task ? (
          <div className="p-6">
            <ErrorState error={error} />
          </div>
        ) : (
          <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-4 px-5 py-4">
              {isStaff ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title !== task.title && update.mutate({ title: title.trim() })}
                  className="w-full rounded-md border-0 px-1 py-1 text-xl font-semibold text-slate-900 hover:bg-slate-50 focus:ring-2 focus:ring-brand"
                />
              ) : (
                <h2 className="text-xl font-semibold text-slate-900">{task.title}</h2>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Prop label="Status">
                  {isStaff ? (
                    <select value={task.status} onChange={(e) => update.mutate({ status: e.target.value as TaskStatus })} className="w-full rounded-md border-0 py-1 pl-2 text-sm ring-1 ring-slate-200 focus:ring-brand">
                      {COLUMNS.map((s) => (
                        <option key={s} value={s}>
                          {taskStatus[s].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={taskStatus[task.status].tone}>{taskStatus[task.status].label}</Badge>
                  )}
                </Prop>
                <Prop label="Assignee">
                  {isStaff ? (
                    <select value={task.assigneeId ?? ''} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })} className="w-full rounded-md border-0 py-1 pl-2 text-sm ring-1 ring-slate-200 focus:ring-brand">
                      <option value="">Unassigned</option>
                      {staff.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  ) : task.assignee ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={task.assignee.name} size="xs" /> {task.assignee.name}
                    </span>
                  ) : (
                    <span className="text-slate-400">Unassigned</span>
                  )}
                </Prop>
                <Prop label="Due">
                  {isStaff ? (
                    <input
                      type="date"
                      value={inputDate(task.dueDate)}
                      onChange={(e) => update.mutate({ dueDate: e.target.value || null })}
                      className="w-full rounded-md border-0 py-1 pl-2 text-sm ring-1 ring-slate-200 focus:ring-brand"
                    />
                  ) : (
                    <span className={cx(isOverdue(task.dueDate) && task.status !== 'DONE' && 'text-red-600')}>{date(task.dueDate)}</span>
                  )}
                </Prop>
                <Prop label="Milestone">
                  {isStaff ? (
                    <select value={task.milestoneId ?? ''} onChange={(e) => update.mutate({ milestoneId: e.target.value || null })} className="w-full rounded-md border-0 py-1 pl-2 text-sm ring-1 ring-slate-200 focus:ring-brand">
                      <option value="">None</option>
                      {project.milestones.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="truncate">{task.milestone?.title ?? '—'}</span>
                  )}
                </Prop>
              </div>

              {isStaff && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" className="size-4 rounded accent-[var(--brand)]" checked={!task.clientVisible} onChange={(e) => update.mutate({ clientVisible: !e.target.checked })} />
                  Internal (hidden from client)
                </label>
              )}

              {isStaff ? (
                <Textarea
                  label="Description"
                  rows={4}
                  value={desc}
                  placeholder="Add details…"
                  onChange={(e) => setDesc(e.target.value)}
                  onBlur={() => desc !== task.description && update.mutate({ description: desc })}
                />
              ) : (
                task.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>
              )}

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Paperclip className="size-4" /> Attachments
                </h3>
                <FileList files={task.files} projectId={project.id} emptyText="No attachments" />
                <div className="mt-2">
                  <Dropzone projectId={project.id} taskId={task.id} compact />
                </div>
              </div>
            </div>

            <div className="flex min-h-[22rem] flex-1 flex-col border-t border-slate-200 bg-slate-50/60 px-5 py-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <MessageSquare className="size-4" /> Comments
              </h3>
              <Thread projectId={project.id} taskId={task.id} className="flex-1" />
            </div>
          </div>
        )}
        {update.isPending && (
          <div className="absolute bottom-4 left-4 rounded-full bg-white p-1.5 shadow">
            <Spinner className="size-4" />
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TaskBoard({ project, onOpen }: { project: Project; onOpen: (taskId: string) => void }) {
  const qc = useQueryClient();
  const { isStaff } = useMe();
  const { toast } = useFeedback();
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [mine, setMine] = useState(false);
  const { user } = useMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tasks', project.id], queryFn: () => api.get<Task[]>(`/projects/${project.id}/tasks`) });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks', project.id] });
      const prev = qc.getQueryData<Task[]>(['tasks', project.id]);
      qc.setQueryData<Task[]>(['tasks', project.id], (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['tasks', project.id], ctx?.prev);
      toast(errorMessage(e), 'error');
    },
    onSettled: () => invalidateTask(qc, project.id),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;

  const tasks = mine ? data.filter((t) => t.assigneeId === user.id) : data;

  const onDrop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/task');
    const t = data.find((x) => x.id === id);
    if (t && t.status !== status) move.mutate({ id, status });
  };

  if (data.length === 0 && !isStaff) {
    return (
      <Card>
        <EmptyState icon={<ListTodo className="size-5" />} title="No tasks shared yet" description="Tasks the team shares with you will show up here." />
      </Card>
    );
  }

  return (
    <div>
      {isStaff && (
        <div className="mb-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="size-4 rounded accent-[var(--brand)]" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Only my tasks
          </label>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating('TODO')}>
            New task
          </Button>
        </div>
      )}
      <div className="scroll-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {COLUMNS.map((status) => {
          const col = tasks.filter((t) => t.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => {
                if (!isStaff) return;
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => onDrop(e, status)}
              className={cx('flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 p-2 transition lg:w-auto lg:flex-1', dragOver === status && 'bg-brand/10 ring-2 ring-brand/40')}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge tone={taskStatus[status].tone}>{taskStatus[status].label}</Badge>
                  <span className="text-xs text-slate-500">{col.length}</span>
                </div>
                {isStaff && (
                  <button onClick={() => setCreating(status)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`Add task to ${taskStatus[status].label}`}>
                    <Plus className="size-4" />
                  </button>
                )}
              </div>
              <div className="flex min-h-24 flex-col gap-2">
                {col.map((t) => (
                  <button
                    key={t.id}
                    draggable={isStaff}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/task', t.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onOpen(t.id)}
                    className="group rounded-lg bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cx('text-sm font-medium text-slate-900', t.status === 'DONE' && 'text-slate-500 line-through')}>{t.title}</span>
                      {!t.clientVisible && <EyeOff className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-label="Internal" />}
                    </div>
                    {t.milestone && <div className="mt-1 truncate text-xs text-slate-500">◆ {t.milestone.title}</div>}
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-xs text-slate-500">
                        {t.dueDate && (
                          <span className={cx('flex items-center gap-1', isOverdue(t.dueDate) && t.status !== 'DONE' && 'font-medium text-red-600')}>
                            <CalendarDays className="size-3.5" />
                            {date(t.dueDate, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {t._count.comments > 0 && (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="size-3.5" />
                            {t._count.comments}
                          </span>
                        )}
                        {t._count.files > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Paperclip className="size-3.5" />
                            {t._count.files}
                          </span>
                        )}
                      </div>
                      {t.assignee && <Avatar name={t.assignee.name} size="xs" />}
                    </div>
                  </button>
                ))}
                {col.length === 0 && <div className="rounded-lg border-2 border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">{isStaff ? 'Drop tasks here' : 'Nothing here'}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {creating && <TaskFormModal project={project} initialStatus={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}
