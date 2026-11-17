import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Pencil, Receipt, Trash2, Users } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { date, isOverdue, relative } from '../lib/format';
import { useProjectRealtime } from '../lib/realtime';
import type { Activity, FileItem, Project } from '../lib/types';
import { useMe } from '../context/session';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageLoader, Tabs, cx, projectStatus, roleLabel, useFeedback } from '../components/ui';
import { Milestones } from '../components/project/Milestones';
import { TaskBoard, TaskDrawer } from '../components/project/Tasks';
import { Dropzone, FileList } from '../components/project/Files';
import { Thread } from '../components/project/Thread';
import { ProjectFormModal } from './Projects';

type Tab = 'milestones' | 'tasks' | 'files' | 'discussion' | 'activity';

function FilesTab({ project }: { project: Project }) {
  const { data, isLoading } = useQuery({ queryKey: ['files', project.id], queryFn: () => api.get<FileItem[]>(`/projects/${project.id}/files`) });
  const [filter, setFilter] = useState('');
  const files = (data ?? []).filter((f) => !filter || f.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      <Dropzone projectId={project.id} />
      <Card className="px-5 py-3">
        <div className="flex items-center justify-between gap-3 py-2">
          <h3 className="font-semibold">All files {data && <span className="font-normal text-slate-400">({data.length})</span>}</h3>
          {(data?.length ?? 0) > 5 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="w-40 rounded-md border-0 py-1 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand"
            />
          )}
        </div>
        <FileList files={files} projectId={project.id} showContext emptyText={isLoading ? 'Loading…' : 'No files shared yet — drop some above.'} />
      </Card>
    </div>
  );
}

function ActivityTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['activity', projectId], queryFn: () => api.get<Activity[]>(`/projects/${projectId}/activity`) });
  if (isLoading) return <PageLoader />;
  if (!data?.length) return <Card><EmptyState title="No activity yet" /></Card>;
  return (
    <Card className="px-5 py-3">
      <ul>
        {data.map((a) => (
          <li key={a.id} className="flex gap-3 py-2.5">
            <Avatar name={a.actor.name} size="sm" />
            <div className="text-sm">
              <span className="font-medium">{a.actor.name}</span> <span className="text-slate-600">{a.summary}</span>
              <div className="text-xs text-slate-400">{relative(a.createdAt)}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isStaff, isAdmin } = useMe();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  useProjectRealtime(id);

  const { data: project, isLoading, error, refetch } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Project>(`/projects/${id}`) });

  const tab = (params.get('tab') as Tab) || (params.get('task') ? 'tasks' : 'milestones');
  const taskId = params.get('task');
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const openTask = (tid: string) => setParams({ tab: 'tasks', task: tid });
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('task');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast('Project deleted');
      navigate('/projects');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <PageLoader />;
  if (error || !project) return <ErrorState error={error} onRetry={refetch} />;

  const st = projectStatus[project.status];
  const awaiting = project.milestones.filter((m) => m.status === 'AWAITING_APPROVAL').length;

  return (
    <>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Projects
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            {isStaff && (
              <Link to={`/clients/${project.client.id}`} className="hover:text-brand hover:underline">
                {project.client.name}
              </Link>
            )}
            <span className={cx('flex items-center gap-1', isOverdue(project.dueDate) && project.status !== 'COMPLETED' && 'text-red-600')}>
              <CalendarDays className="size-4" /> {project.dueDate ? `Due ${date(project.dueDate)}` : 'No due date'}
            </span>
            <span className="flex items-center gap-1" title={project.team.map((u) => `${u.name} (${roleLabel[u.role]})`).join('\n')}>
              <Users className="size-4" />
              <span className="flex -space-x-1.5">
                {project.team.slice(0, 5).map((u) => (
                  <Avatar key={u.id} name={u.name} size="xs" className="ring-2 ring-slate-50" />
                ))}
              </span>
              {project.team.length > 5 && <span>+{project.team.length - 5}</span>}
            </span>
          </div>
          {project.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-slate-600">{project.description}</p>}
        </div>
        {isStaff && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Receipt className="size-4" />} onClick={() => navigate(`/invoices/new?clientId=${project.client.id}&projectId=${project.id}`)}>
              Invoice
            </Button>
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                aria-label="Delete project"
                icon={<Trash2 className="size-4" />}
                onClick={async () =>
                  (await confirm({ title: 'Delete project?', message: 'All milestones, tasks, messages and files will be permanently deleted.', confirmLabel: 'Delete project', danger: true })) &&
                  remove.mutate()
                }
              />
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'milestones', label: 'Milestones', count: awaiting },
            { id: 'tasks', label: 'Tasks' },
            { id: 'files', label: 'Files' },
            { id: 'discussion', label: 'Discussion' },
            { id: 'activity', label: 'Activity' },
          ]}
        />
      </div>

      {tab === 'milestones' && <Milestones project={project} highlightId={params.get('milestone')} />}
      {tab === 'tasks' && <TaskBoard project={project} onOpen={openTask} />}
      {tab === 'files' && <FilesTab project={project} />}
      {tab === 'discussion' && (
        <Card className="flex h-[calc(100vh-20rem)] min-h-[28rem] flex-col p-4">
          <Thread projectId={project.id} className="flex-1" />
        </Card>
      )}
      {tab === 'activity' && <ActivityTab projectId={project.id} />}

      {taskId && <TaskDrawer key={taskId} taskId={taskId} project={project} onClose={closeTask} />}
      {editing && <ProjectFormModal open project={project} onClose={() => setEditing(false)} />}
    </>
  );
}
