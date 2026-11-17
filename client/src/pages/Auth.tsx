import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Brand, Session } from '../lib/types';
import { applyBrand, useSession } from '../context/session';
import { BrandMark } from '../components/Layout';
import { Button, Input, PageLoader, roleLabel } from '../components/ui';

function AuthShell({ brand, title, subtitle, children }: { brand?: Brand | null; title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    applyBrand(brand ?? null);
  }, [brand]);
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand/5 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          {brand ? (
            <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="lg" />
          ) : (
            <span className="inline-flex size-12 items-center justify-center rounded-xl bg-brand text-xl font-bold text-brand-fg">P</span>
          )}
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function useFormError() {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const capture = (e: unknown) => {
    setError(errorMessage(e));
    setFields(e instanceof ApiError && e.details ? e.details : {});
  };
  const reset = () => {
    setError(null);
    setFields({});
  };
  return { error, fields, capture, reset };
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const slug = params.get('org');
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useFormError();

  const { data: brand } = useQuery({
    queryKey: ['brand', slug],
    queryFn: () => api.get<Brand>(`/public/orgs/${slug}`),
    enabled: Boolean(slug),
    retry: false,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    form.reset();
    setBusy(true);
    try {
      const s = await api.post<Session>('/auth/login', { email, password });
      setSession(s);
      navigate(params.get('next') ?? '/', { replace: true });
    } catch (err) {
      form.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={brand} title={brand ? `Sign in to ${brand.name}` : 'Welcome back'} subtitle="Access your projects, files and invoices">
      <form onSubmit={submit} className="space-y-4">
        <FormError error={form.error} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={form.fields.email} />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={form.fields.password}
        />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      {!slug && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Running an agency?{' '}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Create a workspace
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [v, setV] = useState({ agencyName: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const form = useFormError();
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    form.reset();
    setBusy(true);
    try {
      setSession(await api.post<Session>('/auth/register', v));
      navigate('/', { replace: true });
    } catch (err) {
      form.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your workspace" subtitle="A branded portal for your clients in under a minute">
      <form onSubmit={submit} className="space-y-4">
        <FormError error={form.error} />
        <Input label="Agency / company name" required value={v.agencyName} onChange={set('agencyName')} error={form.fields.agencyName} placeholder="Northwind Studio" />
        <Input label="Your name" required autoComplete="name" value={v.name} onChange={set('name')} error={form.fields.name} />
        <Input label="Work email" type="email" required autoComplete="email" value={v.email} onChange={set('email')} error={form.fields.email} />
        <Input
          label="Password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={v.password}
          onChange={set('password')}
          error={form.fields.password}
          hint="At least 8 characters"
        />
        <Button type="submit" className="w-full" loading={busy}>
          Create workspace
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { session, setSession, logout } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useFormError();

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ email: string; role: Session['user']['role']; clientName: string | null; org: Brand }>(`/auth/invite/${token}`),
    retry: false,
  });

  if (isLoading) return <PageLoader />;
  if (error || !invite) {
    return (
      <AuthShell title="Invitation unavailable">
        <p className="text-center text-sm text-slate-600">{errorMessage(error)}</p>
        <Link to="/login" className="mt-6 block text-center text-sm font-medium text-brand hover:underline">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    form.reset();
    setBusy(true);
    try {
      if (session) await logout();
      setSession(await api.post<Session>('/auth/accept-invite', { token, name, password }));
      navigate('/', { replace: true });
    } catch (err) {
      form.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      brand={invite.org}
      title={`Join ${invite.org.name}`}
      subtitle={
        invite.clientName ? (
          <>You've been invited to the <b>{invite.clientName}</b> client portal</>
        ) : (
          <>You've been invited as {roleLabel[invite.role].toLowerCase()} of the team</>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError error={form.error} />
        <Input label="Email" value={invite.email} disabled />
        <Input label="Your name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={form.fields.name} />
        <Input
          label="Choose a password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={form.fields.password}
          hint="At least 8 characters"
        />
        <Button type="submit" className="w-full" loading={busy}>
          Accept invitation
        </Button>
      </form>
    </AuthShell>
  );
}
