import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  MessageSquareWarning,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { date, dateTime, inputDate, isOverdue } from '../../lib/format';
import type { FileItem, Milestone, Project } from '../../lib/types';
import { useMe } from '../../context/session';
import { Badge, Button, Card, EmptyState, Input, Modal, ProgressBar, Textarea, cx, milestoneStatus, useFeedback } from '../ui';
import { Dropzone, FileList } from './Files';

function useMilestoneMutation(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  return (success?: string) => ({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['activity', projectId] });
      if (success) toast(success);
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
  });
}

function MilestoneFormModal({ projectId, milestone, onClose }: { projectId: string; milestone?: Milestone; onClose: () => void }) {
  const [v, setV] = useState({ title: milestone?.title ?? '', description: milestone?.description ?? '', dueDate: inputDate(milestone?.dueDate) });
  const handlers = useMilestoneMutation(projectId);
  const save = useMutation({
    mutationFn: () =>
      milestone
        ? api.patch(`/milestones/${milestone.id}`, { ...v, dueDate: v.dueDate || null })
        : api.post(`/projects/${projectId}/milestones`, { ...v, dueDate: v.dueDate || null }),
    ...handlers(milestone ? 'Milestone updated' : 'Milestone added'),
    onSettled: (_d, e) => !e && onClose(),
  });
  const fields = save.error instanceof ApiError ? (save.error.details ?? {}) : {};
  return (
    <Modal
      open
      onClose={onClose}
      title={milestone ? 'Edit milestone' : 'New milestone'}
      description="Milestones are deliverables your client reviews and approves."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ms-form" loading={save.isPending}>
            {milestone ? 'Save' : 'Add milestone'}
          </Button>
        </>
      }
    >
      <form
        id="ms-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input label="Title" required autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} error={fields.title} placeholder="e.g. Homepage design" />
        <Textarea label="What will be delivered?" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <Input label="Due date" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
      </form>
    </Modal>
  );
}

function DecisionModal({ milestone, mode, onClose }: { milestone: Milestone; mode: 'approve' | 'changes' | 'submit'; onClose: () => void }) {
  const [note, setNote] = useState('');
  const handlers = useMilestoneMutation(milestone.projectId);
  const path = mode === 'approve' ? 'approve' : mode === 'changes' ? 'request-changes' : 'submit';
  const msg = mode === 'approve' ? 'Milestone approved 🎉' : mode === 'changes' ? 'Change request sent' : 'Sent to client for approval';
  const act = useMutation({ mutationFn: () => api.post(`/milestones/${milestone.id}/${path}`, { note: note || undefined }), ...handlers(msg), onSettled: (_d, e) => !e && onClose() });
  const copy = {
    approve: { title: `Approve “${milestone.title}”?`, desc: 'This signs off the deliverable. The team will be notified.', label: 'Approve', placeholder: 'Optional message for the team', variant: 'success' as const },
    changes: { title: 'Request changes', desc: `Tell the team what should change in “${milestone.title}”.`, label: 'Send request', placeholder: 'Please describe the changes you need…', variant: 'primary' as const },
    submit: { title: 'Submit for client approval', desc: `The client will be notified to review “${milestone.title}”.`, label: 'Submit', placeholder: 'Optional note for the client (what to review, links…)', variant: 'primary' as const },
  }[mode];
  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.desc}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={copy.variant} loading={act.isPending} disabled={mode === 'changes' && !note.trim()} onClick={() => act.mutate()}>
            {copy.label}
          </Button>
        </>
      }
    >
      <Textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={copy.placeholder} required={mode === 'changes'} />
    </Modal>
  );
}

function StatusIcon({ status }: { status: Milestone['status'] }) {
  if (status === 'APPROVED') return <CheckCircle2 className="size-6 text-emerald-500" />;
  if (status === 'AWAITING_APPROVAL') return <Clock className="size-6 text-amber-500" />;
  if (status === 'CHANGES_REQUESTED') return <MessageSquareWarning className="size-6 text-red-500" />;
  if (status === 'IN_PROGRESS') return <Play className="size-6 rounded-full bg-sky-100 p-1 text-sky-600" />;
  return <Circle className="size-6 text-slate-300" />;
}

function MilestoneCard({
  m,
  project,
  index,
  total,
  highlighted,
}: {
  m: Milestone;
  project: Project;
  index: number;
  total: number;
  highlighted: boolean;
}) {
  const { isStaff, isAdmin, isClient } = useMe();
  const { confirm } = useFeedback();
  const [open, setOpen] = useState(highlighted || m.status === 'AWAITING_APPROVAL');
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'changes' | 'submit' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const handlers = useMilestoneMutation(project.id);

  useEffect(() => {
    if (highlighted) {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  const files = useQuery({
    queryKey: ['files', project.id, { milestoneId: m.id }],
    queryFn: () => api.get<FileItem[]>(`/projects/${project.id}/files?milestoneId=${m.id}`),
    enabled: open,
  });

  const start = useMutation({ mutationFn: () => api.patch(`/milestones/${m.id}`, { status: 'IN_PROGRESS' }), ...handlers('Marked in progress') });
  const move = useMutation({ mutationFn: (direction: 'up' | 'down') => api.post(`/milestones/${m.id}/move`, { direction }), ...handlers() });
  const remove = useMutation({ mutationFn: () => api.delete(`/milestones/${m.id}`), ...handlers('Milestone deleted') });

  const canDecide = m.status === 'AWAITING_APPROVAL' && (isClient || isAdmin);
  const st = milestoneStatus[m.status];
  const overdue = isOverdue(m.dueDate) && m.status !== 'APPROVED';

  return (
    <div ref={ref} className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div className="relative z-10 rounded-full bg-white">
          <StatusIcon status={m.status} />
        </div>
        {index < total - 1 && <div className={cx('w-0.5 flex-1', m.status === 'APPROVED' ? 'bg-emerald-200' : 'bg-slate-200')} />}
      </div>

      <Card className={cx('mb-4 min-w-0 flex-1 transition', highlighted && 'ring-2 ring-brand', m.status === 'AWAITING_APPROVAL' && 'ring-amber-300')}>
        <div className="flex items-start gap-3 p-4">
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">{m.title}</h3>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className={cx('flex items-center gap-1', overdue && 'font-medium text-red-600')}>
                <CalendarDays className="size-3.5" />
                {m.dueDate ? `${overdue ? 'Overdue · ' : 'Due '}${date(m.dueDate)}` : 'No due date'}
              </span>
              {m.taskCount > 0 && (
                <span className="flex items-center gap-1">
                  <Check className="size-3.5" /> {m.tasksDone}/{m.taskCount} tasks
                </span>
              )}
              {m.fileCount > 0 && (
                <span className="flex items-center gap-1">
                  <Paperclip className="size-3.5" /> {m.fileCount} file{m.fileCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            {canDecide && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDecision('changes')}>
                  Request changes
                </Button>
                <Button size="sm" variant="success" icon={<Check className="size-3.5" />} onClick={() => setDecision('approve')}>
                  Approve
                </Button>
              </>
            )}
            {isStaff && m.status !== 'APPROVED' && m.status !== 'AWAITING_APPROVAL' && (
              <Button size="sm" variant="secondary" icon={<Send className="size-3.5" />} onClick={() => setDecision('submit')}>
                <span className="hidden sm:inline">Submit for approval</span>
                <span className="sm:hidden">Submit</span>
              </Button>
            )}
            {isStaff && (
              <div className="relative">
                <button onClick={() => setMenu((x) => !x)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                    <div className="animate-pop-in absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
                      {[
                        { icon: Pencil, label: 'Edit', on: () => setEditing(true) },
                        ...(m.status !== 'IN_PROGRESS' ? [{ icon: Play, label: m.status === 'PENDING' ? 'Mark in progress' : 'Reopen (in progress)', on: () => start.mutate() }] : []),
                        ...(index > 0 ? [{ icon: ArrowUp, label: 'Move up', on: () => move.mutate('up') }] : []),
                        ...(index < total - 1 ? [{ icon: ArrowDown, label: 'Move down', on: () => move.mutate('down') }] : []),
                        {
                          icon: Trash2,
                          label: 'Delete',
                          danger: true,
                          on: async () => {
                            if (await confirm({ title: 'Delete milestone?', message: 'Files attached to it are deleted. Tasks are kept.', confirmLabel: 'Delete', danger: true })) remove.mutate();
                          },
                        },
                      ].map((a) => (
                        <button
                          key={a.label}
                          onClick={() => {
                            setMenu(false);
                            a.on();
                          }}
                          className={cx('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50', 'danger' in a && a.danger ? 'text-red-600' : 'text-slate-700')}
                        >
                          <a.icon className="size-4" /> {a.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={() => setOpen((o) => !o)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label={open ? 'Collapse' : 'Expand'}>
              <ChevronDown className={cx('size-4 transition', open && 'rotate-180')} />
            </button>
          </div>
        </div>

        {m.status !== 'PENDING' && m.decisionNote && (
          <div
            className={cx(
              'mx-4 mb-3 rounded-lg px-3 py-2 text-sm',
              m.status === 'CHANGES_REQUESTED' || m.status === 'IN_PROGRESS' ? 'bg-red-50 text-red-800' : m.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900',
            )}
          >
            <span className="font-medium">
              {m.status === 'CHANGES_REQUESTED' || m.status === 'IN_PROGRESS' ? 'Requested changes' : m.status === 'APPROVED' ? 'Approval note' : 'Note from the team'}:
            </span>{' '}
            <span className="whitespace-pre-wrap">{m.decisionNote}</span>
          </div>
        )}
        {m.status === 'AWAITING_APPROVAL' && isClient && (
          <div className="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            👋 This milestone is ready for your review. Check the files below, then approve or request changes.
          </div>
        )}

        {open && (
          <div className="space-y-4 border-t border-slate-100 px-4 py-4">
            {m.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{m.description}</p>}
            {m.taskCount > 0 && (
              <div>
                <ProgressBar value={m.tasksDone} max={m.taskCount} />
              </div>
            )}
            {m.decidedAt && (
              <p className="text-xs text-slate-500">
                {m.status === 'APPROVED' ? 'Approved' : 'Reviewed'} {dateTime(m.decidedAt)}
              </p>
            )}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Deliverables</h4>
              <FileList files={files.data ?? []} projectId={project.id} emptyText={files.isLoading ? 'Loading…' : 'No files attached to this milestone yet'} />
              <div className="mt-2">
                <Dropzone projectId={project.id} milestoneId={m.id} compact />
              </div>
            </div>
          </div>
        )}
      </Card>

      {editing && <MilestoneFormModal projectId={project.id} milestone={m} onClose={() => setEditing(false)} />}
      {decision && <DecisionModal milestone={m} mode={decision} onClose={() => setDecision(null)} />}
    </div>
  );
}

export function Milestones({ project, highlightId }: { project: Project; highlightId?: string | null }) {
  const { isStaff } = useMe();
  const [creating, setCreating] = useState(false);
  const ms = project.milestones;
  const approved = ms.filter((m) => m.status === 'APPROVED').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="font-medium text-slate-700">Approval progress</span>
            <span className="text-slate-500">
              {approved} of {ms.length} approved
            </span>
          </div>
          <ProgressBar value={approved} max={ms.length} className="h-2" />
        </div>
        {isStaff && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Add milestone
          </Button>
        )}
      </div>

      {ms.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="size-5" />}
            title="No milestones yet"
            description={isStaff ? 'Break the project into deliverables your client can review and approve.' : 'Milestones will appear here as the project is planned.'}
            action={
              isStaff ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  Add milestone
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="pt-2">
          {ms.map((m, i) => (
            <MilestoneCard key={m.id} m={m} project={project} index={i} total={ms.length} highlighted={highlightId === m.id} />
          ))}
        </div>
      )}
      {creating && <MilestoneFormModal projectId={project.id} onClose={() => setCreating(false)} />}
    </div>
  );
}
