import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, FolderKanban, Receipt, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { date, isOverdue, money, relative } from '../lib/format';
import type { Activity, Milestone } from '../lib/types';
import { useMe } from '../context/session';
import { PageHeader } from '../components/Layout';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageLoader, cx, milestoneStatus } from '../components/ui';

interface DashboardData {
  projects: { active: number; onHold: number; completed: number };
  awaitingApproval: (Milestone & { project: { id: string; name: string; client: { name: string } } })[];
  outstanding: Record<string, number>;
  paidThisMonth: Record<string, number>;
  overdueCount: number;
  openInvoices: { id: string; number: string; client: string; currency: string; dueDate: string | null; total: number }[];
  activity: (Activity & { project: { id: string; name: string } })[];
  upcoming: (Milestone & { project: { id: string; name: string } })[];
  clientCount?: number;
}

const sumLabel = (m: Record<string, number>, fallback: string) => {
  const entries = Object.entries(m);
  if (!entries.length) return money(0, fallback);
  return entries.map(([c, v]) => money(v, c)).join(' · ');
};

function Stat({ icon, label, value, hint, tone = 'slate' }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: 'slate' | 'amber' | 'green' | 'brand' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700', brand: 'bg-brand/10 text-brand' };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className={cx('rounded-lg p-2', tones[tone])}>{icon}</span>
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
      <div className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function DashboardPage() {
  const { user, org, isStaff, client } = useMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greet}, ${user.name.split(' ')[0]}`}
        subtitle={isStaff ? `Here's what's happening across ${org.name}` : `Your projects with ${org.name}${client ? ` · ${client.name}` : ''}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<FolderKanban className="size-5" />} tone="brand" label="Active projects" value={data.projects.active} hint={`${data.projects.completed} completed`} />
        <Stat
          icon={<CheckCircle2 className="size-5" />}
          tone="amber"
          label={isStaff ? 'Awaiting client approval' : 'Needs your approval'}
          value={data.awaitingApproval.length}
        />
        <Stat
          icon={<Receipt className="size-5" />}
          tone={data.overdueCount ? 'amber' : 'slate'}
          label="Outstanding"
          value={sumLabel(data.outstanding, org.currency)}
          hint={data.overdueCount ? <span className="text-red-600">{data.overdueCount} overdue</span> : `${data.openInvoices.length} open invoice(s)`}
        />
        <Stat icon={<Wallet className="size-5" />} tone="green" label={isStaff ? 'Collected this month' : 'Paid this month'} value={sumLabel(data.paidThisMonth, org.currency)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">{isStaff ? 'Waiting on clients' : 'Ready for your review'}</h2>
            </div>
            {data.awaitingApproval.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nothing pending" description={isStaff ? 'No milestones are waiting for client sign-off.' : 'No milestones need your approval right now.'} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.awaitingApproval.map((m) => (
                  <li key={m.id}>
                    <Link to={`/projects/${m.project.id}?milestone=${m.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                      <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
                        <AlertCircle className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{m.title}</div>
                        <div className="truncate text-xs text-slate-500">
                          {m.project.name}
                          {isStaff && ` · ${m.project.client.name}`} · submitted {m.submittedAt ? relative(m.submittedAt) : ''}
                        </div>
                      </div>
                      <span className="hidden text-sm font-medium text-brand sm:inline">{isStaff ? 'View' : 'Review'}</span>
                      <ArrowRight className="size-4 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Recent activity</h2>
            </div>
            {data.activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Uploads, approvals and updates will show up here." />
            ) : (
              <ul className="space-y-0 px-5 py-2">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex gap-3 py-2.5">
                    <Avatar name={a.actor.name} size="sm" />
                    <div className="min-w-0 text-sm">
                      <span className="font-medium">{a.actor.name}</span> <span className="text-slate-600">{a.summary}</span>
                      <div className="text-xs text-slate-400">
                        <Link to={`/projects/${a.project.id}`} className="hover:text-brand hover:underline">
                          {a.project.name}
                        </Link>{' '}
                        · {relative(a.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Open invoices</h2>
              <Link to="/invoices" className="text-xs font-medium text-brand hover:underline">
                View all
              </Link>
            </div>
            {data.openInvoices.length === 0 ? (
              <EmptyState title="All paid up" description="No unpaid invoices." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.openInvoices.map((i) => (
                  <li key={i.id}>
                    <Link to={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{i.number}</div>
                        <div className={cx('truncate text-xs', isOverdue(i.dueDate) ? 'text-red-600' : 'text-slate-500')}>
                          {isStaff && `${i.client} · `}
                          {i.dueDate ? `${isOverdue(i.dueDate) ? 'Overdue since' : 'Due'} ${date(i.dueDate, { month: 'short', day: 'numeric' })}` : 'No due date'}
                        </div>
                      </div>
                      <span className="text-sm font-semibold">{money(i.total, i.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Upcoming milestones</h2>
            </div>
            {data.upcoming.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-5" />} title="No upcoming deadlines" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.upcoming.map((m) => (
                  <li key={m.id}>
                    <Link to={`/projects/${m.project.id}?milestone=${m.id}`} className="block px-5 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{m.title}</span>
                        <Badge tone={milestoneStatus[m.status].tone}>{milestoneStatus[m.status].label}</Badge>
                      </div>
                      <div className={cx('mt-0.5 text-xs', isOverdue(m.dueDate) ? 'text-red-600' : 'text-slate-500')}>
                        {m.project.name} · {date(m.dueDate, { month: 'short', day: 'numeric' })}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
