import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Check, Copy, Mail, Pencil, Phone, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { date, money, relative } from '../lib/format';
import type { Client, ClientDetail, Invoice } from '../lib/types';
import { useMe } from '../context/session';
import { PageHeader } from '../components/Layout';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageLoader, invoiceStatus, projectStatus, useFeedback } from '../components/ui';
import { ProjectFormModal } from './Projects';

function ClientFormModal({ client, onClose }: { client?: Client; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [v, setV] = useState({ name: client?.name ?? '', email: client?.email ?? '', phone: client?.phone ?? '' });
  const save = useMutation({
    mutationFn: () => (client ? api.patch<Client>(`/clients/${client.id}`, v) : api.post<Client>('/clients', v)),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client', c.id] });
      toast(client ? 'Client updated' : 'Client added');
      onClose();
      if (!client) navigate(`/clients/${c.id}`);
    },
  });
  const fields = save.error instanceof ApiError ? (save.error.details ?? {}) : {};
  return (
    <Modal
      open
      onClose={onClose}
      title={client ? 'Edit client' : 'New client'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="client-form" loading={save.isPending}>
            {client ? 'Save' : 'Add client'}
          </Button>
        </>
      }
    >
      <form
        id="client-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input label="Company name" required autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={fields.name} />
        <Input label="Billing email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={fields.email} hint="Invoices are emailed here (if email is configured)" />
        <Input label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      </form>
    </Modal>
  );
}

/** Invite modal used for both client users and team members. Shows a copyable link. */
export function InviteModal({ role, clientId, title, onClose, roles }: { role?: 'CLIENT'; clientId?: string; title: string; onClose: () => void; roles?: ('ADMIN' | 'MEMBER')[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [chosenRole, setRole] = useState<'ADMIN' | 'MEMBER' | 'CLIENT'>(role ?? 'MEMBER');
  const [result, setResult] = useState<{ inviteUrl: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string; emailed: boolean }>('/org/invites', { email, role: chosenRole, clientId }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['client', clientId] });
      qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
  const fields = invite.error instanceof ApiError ? (invite.error.details ?? {}) : {};

  const copy = async () => {
    await navigator.clipboard.writeText(result!.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={invite.isPending}>
              Create invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Check className="size-4" />
            {result.emailed ? `Invitation emailed to ${email}.` : 'Invitation created. Share this link with them:'}
          </div>
          <div className="flex gap-2">
            <input readOnly value={result.inviteUrl} className="min-w-0 flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 font-mono text-xs ring-1 ring-slate-200" onFocus={(e) => e.target.select()} />
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-slate-500">The link expires in 7 days and can be used once.</p>
        </div>
      ) : (
        <form
          id="invite-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          {invite.error && !Object.keys(fields).length && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(invite.error)}</p>}
          <Input label="Email address" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
          {roles && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-slate-700">Role</span>
              {roles.map((r) => (
                <label key={r} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 ring-1 ring-slate-200 has-[:checked]:bg-brand/5 has-[:checked]:ring-brand">
                  <input type="radio" name="role" className="mt-1 accent-[var(--brand)]" checked={chosenRole === r} onChange={() => setRole(r)} />
                  <span className="text-sm">
                    <span className="font-medium">{r === 'ADMIN' ? 'Admin' : 'Member'}</span>
                    <span className="block text-slate-500">
                      {r === 'ADMIN' ? 'Full access, including billing, branding and team management.' : 'Can work on all projects, files, tasks and invoices.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

export function ClientsPage() {
  const { org } = useMe();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['clients'], queryFn: () => api.get<Client[]>('/clients') });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Companies you work with and their portal access"
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New client
          </Button>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="No clients yet"
            description="Add your first client, then invite them to their own branded portal."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New client
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Projects</th>
                  <th className="px-5 py-3">Portal users</th>
                  <th className="px-5 py-3 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/clients/${c.id}`} className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 font-semibold text-slate-600">{c.name[0]?.toUpperCase()}</span>
                        <span>
                          <span className="block font-medium text-slate-900 hover:text-brand">{c.name}</span>
                          <span className="text-xs text-slate-500">{c.email ?? '—'}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{c._count?.projects ?? 0}</td>
                    <td className="px-5 py-3 text-slate-600">{c._count?.users ?? 0}</td>
                    <td className="px-5 py-3 text-right font-medium">{c.outstanding ? money(c.outstanding, org.currency) : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {creating && <ClientFormModal onClose={() => setCreating(false)} />}
    </>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin, org } = useMe();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const { data: client, isLoading, error, refetch } = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const invoices = useQuery({ queryKey: ['invoices', { clientId: id }], queryFn: () => api.get<Invoice[]>(`/invoices?clientId=${id}`) });

  const onDone = (msg: string) => ({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast(msg);
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
  });
  const revoke = useMutation({ mutationFn: (inviteId: string) => api.delete(`/org/invites/${inviteId}`), ...onDone('Invitation revoked') });
  const removeUser = useMutation({ mutationFn: (userId: string) => api.delete(`/org/members/${userId}`), ...onDone('Access removed') });
  const remove = useMutation({
    mutationFn: () => api.delete(`/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast('Client deleted');
      navigate('/clients');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <PageLoader />;
  if (error || !client) return <ErrorState error={error} onRetry={refetch} />;

  const portalLink = `${window.location.origin}/login?org=${org.slug}`;

  return (
    <>
      <Link to="/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Clients
      </Link>
      <PageHeader
        title={client.name}
        subtitle={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {client.email && (
              <span className="flex items-center gap-1">
                <Mail className="size-4" /> {client.email}
              </span>
            )}
            {client.phone && (
              <span className="flex items-center gap-1">
                <Phone className="size-4" /> {client.phone}
              </span>
            )}
            <span>Client since {date(client.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                aria-label="Delete client"
                icon={<Trash2 className="size-4" />}
                onClick={async () =>
                  (await confirm({
                    title: `Delete ${client.name}?`,
                    message: 'This permanently deletes the client, their projects, files, invoices and portal accounts.',
                    confirmLabel: 'Delete client',
                    danger: true,
                  })) && remove.mutate()
                }
              />
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Projects</h2>
              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setNewProject(true)}>
                New project
              </Button>
            </div>
            {client.projects.length === 0 ? (
              <EmptyState title="No projects yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {client.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                      <span className="font-medium">{p.name}</span>
                      <span className="flex items-center gap-3 text-xs text-slate-500">
                        {p.dueDate && date(p.dueDate)}
                        <Badge tone={projectStatus[p.status].tone}>{projectStatus[p.status].label}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Invoices</h2>
              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => navigate(`/invoices/new?clientId=${client.id}`)}>
                New invoice
              </Button>
            </div>
            {!invoices.data?.length ? (
              <EmptyState title="No invoices yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {invoices.data.map((i) => (
                  <li key={i.id}>
                    <Link to={`/invoices/${i.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                      <span>
                        <span className="font-medium">{i.number}</span>
                        <span className="ml-2 text-xs text-slate-500">{date(i.issuedAt ?? i.createdAt)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm font-medium">{money(i.total, i.currency)}</span>
                        <Badge tone={invoiceStatus[i.status].tone}>{invoiceStatus[i.status].label}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Portal access</h2>
            <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setInviting(true)}>
              Invite
            </Button>
          </div>
          <div className="space-y-4 px-5 py-4">
            {client.users.length === 0 && client.invites.length === 0 && (
              <p className="text-sm text-slate-500">Nobody from {client.name} has portal access yet. Invite them to share files, approve milestones and pay invoices online.</p>
            )}
            {client.users.map((u) => (
              <div key={u.id} className="flex items-center gap-3">
                <Avatar name={u.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {u.email} · {u.lastSeenAt ? `active ${relative(u.lastSeenAt)}` : 'never signed in'}
                  </div>
                </div>
                <button
                  onClick={async () => (await confirm({ title: `Remove ${u.name}?`, message: 'They will lose access to the portal immediately.', confirmLabel: 'Remove', danger: true })) && removeUser.mutate(u.id)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove ${u.name}`}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {client.invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-slate-100">
                  <Mail className="size-3.5 text-slate-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.email}</div>
                  <div className="text-xs text-amber-600">Invitation pending</div>
                </div>
                <button onClick={() => revoke.mutate(i.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Revoke invitation">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <div className="mb-1 font-medium text-slate-700">Branded sign-in link</div>
              <code className="break-all">{portalLink}</code>
            </div>
          </div>
        </Card>
      </div>

      {editing && <ClientFormModal client={client} onClose={() => setEditing(false)} />}
      {inviting && <InviteModal role="CLIENT" clientId={client.id} title={`Invite someone from ${client.name}`} onClose={() => setInviting(false)} />}
      {newProject && <ProjectFormModal open defaultClientId={client.id} onClose={() => setNewProject(false)} />}
    </>
  );
}
