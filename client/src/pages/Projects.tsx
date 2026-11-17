import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FolderKanban, Plus, Search } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { date, inputDate, isOverdue } from '../lib/format';
import type { Client, Project, ProjectStatus, ProjectSummary } from '../lib/types';
import { useMe } from '../context/session';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageLoader, ProgressBar, Select, Textarea, cx, projectStatus, useFeedback } from '../components/ui';

export function ProjectFormModal({
  open,
  onClose,
  project,
  defaultClientId,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
  defaultClientId?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [v, setV] = useState(() => ({
    name: project?.name ?? '',
    description: project?.description ?? '',
    clientId: project?.clientId ?? defaultClientId ?? '',
    dueDate: inputDate(project?.dueDate),
    status: project?.status ?? ('ACTIVE' as ProjectStatus),
  }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api.get<Client[]>('/clients'), enabled: open && !project });

  const save = useMutation({
    mutationFn: () =>
      project
        ? api.patch<Project>(`/projects/${project.id}`, { name: v.name, description: v.description, dueDate: v.dueDate || null, status: v.status })
        : api.post<Project>('/projects', { name: v.name, description: v.description, clientId: v.clientId, dueDate: v.dueDate || null }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project', p.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(project ? 'Project updated' : 'Project created');
      onClose();
      if (!project) navigate(`/projects/${p.id}`);
    },
    onError: (e) => setFields(e instanceof ApiError && e.details ? e.details : {}),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="project-form" loading={save.isPending}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-4">
        {save.error && !Object.keys(fields).length && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(save.error)}</p>}
        <Input label="Project name" required autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={fields.name} />
        {!project && (
          <Select
            label="Client"
            required
            value={v.clientId}
            onChange={(e) => setV({ ...v, clientId: e.target.value })}
            error={fields.clientId}
            hint={clients.data?.length === 0 ? 'Add a client first from the Clients page.' : undefined}
          >
            <option value="">Select a client…</option>
            {clients.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Textarea label="Description" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Due date" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} error={fields.dueDate} />
          {project && (
            <Select label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ProjectStatus })}>
              {Object.entries(projectStatus).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const { isStaff } = useMe();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ProjectStatus | 'ALL'>('ALL');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/projects') });

  const list = (data ?? []).filter(
    (p) =>
      (filter === 'ALL' || p.status === filter) &&
      (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.client.name.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={isStaff ? 'Everything your team is delivering' : 'Projects we are working on for you'}
        actions={
          isStaff && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New project
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(['ALL', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cx('rounded-md px-3 py-1 text-xs font-medium', filter === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
            >
              {s === 'ALL' ? 'All' : projectStatus[s].label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title={data?.length ? 'No matching projects' : 'No projects yet'}
            description={isStaff ? 'Create a project to start sharing files, milestones and updates with a client.' : 'Your projects will appear here once they are set up.'}
            action={
              isStaff && !data?.length ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New project
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="group">
              <Card className="flex h-full flex-col p-5 transition group-hover:shadow-md group-hover:ring-brand/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900 group-hover:text-brand">{p.name}</h3>
                    {isStaff && <p className="truncate text-sm text-slate-500">{p.client.name}</p>}
                  </div>
                  <Badge tone={projectStatus[p.status].tone}>{projectStatus[p.status].label}</Badge>
                </div>
                {p.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
                <div className="mt-auto pt-5">
                  <div className="mb-1.5 flex justify-between text-xs text-slate-500">
                    <span>
                      {p.milestonesApproved}/{p.milestoneCount} milestones approved
                    </span>
                    <span>
                      {p.tasksDone}/{p.taskCount} tasks
                    </span>
                  </div>
                  <ProgressBar value={p.milestonesApproved} max={p.milestoneCount} />
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className={cx('flex items-center gap-1', isOverdue(p.dueDate) && p.status !== 'COMPLETED' ? 'text-red-600' : 'text-slate-500')}>
                      <CalendarDays className="size-3.5" />
                      {p.dueDate ? date(p.dueDate) : 'No due date'}
                    </span>
                    {p.awaitingApproval > 0 && <Badge tone="amber">{p.awaitingApproval} awaiting approval</Badge>}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {creating && <ProjectFormModal open onClose={() => setCreating(false)} />}
    </>
  );
}
