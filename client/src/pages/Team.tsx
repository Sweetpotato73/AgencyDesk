import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, UserPlus, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { relative } from '../lib/format';
import type { Role, UserLite } from '../lib/types';
import { useMe } from '../context/session';
import { PageHeader } from '../components/Layout';
import { Avatar, Badge, Button, Card, ErrorState, PageLoader, roleLabel, useFeedback } from '../components/ui';
import { InviteModal } from './Clients';

interface Members {
  members: (UserLite & { email: string; createdAt: string; lastSeenAt: string | null })[];
  invites: { id: string; email: string; role: Role; createdAt: string; expiresAt: string }[];
}

export function TeamPage() {
  const qc = useQueryClient();
  const { user, isAdmin } = useMe();
  const { toast, confirm } = useFeedback();
  const [inviting, setInviting] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['members'], queryFn: () => api.get<Members>('/org/members') });
  const done = (msg: string) => ({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      toast(msg);
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
  });
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(`/org/members/${id}`, { role }), ...done('Role updated') });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/org/members/${id}`), ...done('Member removed') });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/org/invites/${id}`), ...done('Invitation revoked') });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="People at your agency who can access every client and project"
        actions={
          isAdmin && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
              Invite teammate
            </Button>
          )
        }
      />
      <Card className="divide-y divide-slate-100">
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {m.name} {m.id === user.id && <Badge>You</Badge>}
              </div>
              <div className="truncate text-sm text-slate-500">
                {m.email} · {m.lastSeenAt ? `active ${relative(m.lastSeenAt)}` : `joined ${relative(m.createdAt)}`}
              </div>
            </div>
            {isAdmin && m.role !== 'OWNER' && m.id !== user.id ? (
              <select
                value={m.role}
                onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })}
                className="rounded-lg border-0 py-1.5 pl-3 pr-8 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand"
              >
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
              </select>
            ) : (
              <Badge tone={m.role === 'OWNER' ? 'brand' : 'slate'}>{roleLabel[m.role]}</Badge>
            )}
            {isAdmin && m.role !== 'OWNER' && m.id !== user.id && (
              <button
                onClick={async () => (await confirm({ title: `Remove ${m.name}?`, message: 'They will lose access immediately. Their past work stays intact.', confirmLabel: 'Remove', danger: true })) && remove.mutate(m.id)}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Remove ${m.name}`}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        {data.invites.map((i) => (
          <div key={i.id} className="flex items-center gap-4 px-5 py-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-slate-100">
              <Mail className="size-4 text-slate-500" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{i.email}</div>
              <div className="text-sm text-amber-600">Invited as {roleLabel[i.role].toLowerCase()} · pending</div>
            </div>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                Revoke
              </Button>
            )}
          </div>
        ))}
      </Card>
      {inviting && <InviteModal title="Invite a teammate" roles={['MEMBER', 'ADMIN']} onClose={() => setInviting(false)} />}
    </>
  );
}
