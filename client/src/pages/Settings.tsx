import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { putWithProgress } from '../lib/upload';
import type { Brand, Session } from '../lib/types';
import { applyBrand, useMe, useSession } from '../context/session';
import { BrandMark, PageHeader } from '../components/Layout';
import { Button, Card, Input, roleLabel, useFeedback } from '../components/ui';

const PRESETS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#0f172a'];

function BrandingCard() {
  const { org } = useMe();
  const { session, setSession } = useSession();
  const { toast } = useFeedback();
  const [v, setV] = useState({ name: org.name, brandColor: org.brandColor, currency: org.currency.toUpperCase() });
  const [logoProgress, setLogoProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const updateOrg = (brand: Brand) => {
    if (session) setSession({ ...session, org: brand });
  };

  const save = useMutation({
    mutationFn: () => api.patch<Brand>('/org', { ...v, currency: v.currency }),
    onSuccess: (b) => {
      updateOrg(b);
      toast('Branding saved');
    },
  });
  const fields = save.error instanceof ApiError ? (save.error.details ?? {}) : {};

  const uploadLogo = async (f: File) => {
    try {
      if (f.size > 2 * 1024 * 1024) throw new Error('Logo must be under 2 MB');
      setLogoProgress(0);
      const { key, upload } = await api.post<{ key: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>('/org/logo/upload-url', {
        contentType: f.type,
        size: f.size,
      });
      await putWithProgress(upload, f, setLogoProgress);
      updateOrg(await api.post<Brand>('/org/logo', { key }));
      toast('Logo updated');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLogoProgress(null);
    }
  };
  const removeLogo = useMutation({ mutationFn: () => api.delete<Brand>('/org/logo'), onSuccess: (b) => updateOrg(b) });

  const portalLink = `${window.location.origin}/login?org=${org.slug}`;

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">White-label branding</h2>
      <p className="mt-1 text-sm text-slate-500">Your clients see your name, logo and color everywhere in their portal and on invoices.</p>

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input label="Workspace name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={fields.name} />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Logo</span>
            <div className="flex items-center gap-3">
              <BrandMark name={v.name || org.name} logoUrl={org.logoUrl} size="lg" />
              <Button variant="secondary" size="sm" icon={<ImageUp className="size-4" />} loading={logoProgress !== null} onClick={() => file.current?.click()}>
                {logoProgress !== null ? `${logoProgress}%` : 'Upload'}
              </Button>
              {org.logoUrl && (
                <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => removeLogo.mutate()}>
                  Remove
                </Button>
              )}
              <input
                ref={file}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uploadLogo(f);
                }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">PNG, JPEG, WebP or GIF up to 2 MB. Square works best.</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Brand color</span>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setV({ ...v, brandColor: c });
                    applyBrand({ brandColor: c, name: v.name });
                  }}
                  className="size-8 rounded-full ring-offset-2 transition hover:scale-110"
                  style={{ background: c, boxShadow: v.brandColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }}
                  aria-label={c}
                />
              ))}
              <input
                type="color"
                value={v.brandColor}
                onChange={(e) => {
                  setV({ ...v, brandColor: e.target.value });
                  applyBrand({ brandColor: e.target.value, name: v.name });
                }}
                className="size-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                aria-label="Custom color"
              />
              <code className="text-xs text-slate-500">{v.brandColor}</code>
            </div>
            {fields.brandColor && <p className="mt-1 text-xs text-red-600">{fields.brandColor}</p>}
          </div>

          <Input
            label="Default currency"
            maxLength={3}
            value={v.currency}
            onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })}
            error={fields.currency}
            hint="Used for new invoices (USD, EUR, GBP, SAR…)"
          />

          {save.error && !Object.keys(fields).length && <p className="text-sm text-red-600">{errorMessage(save.error)}</p>}
          <Button type="submit" loading={save.isPending}>
            Save branding
          </Button>
        </form>

        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">Client sign-in link</span>
          <div className="rounded-lg bg-slate-50 p-3">
            <code className="break-all text-xs">{portalLink}</code>
          </div>
          <p className="mt-2 text-xs text-slate-500">Share this with clients — the sign-in page shows your branding.</p>

          <span className="mb-2 mt-6 block text-sm font-medium text-slate-700">Preview</span>
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
              <BrandMark name={v.name || org.name} logoUrl={org.logoUrl} />
              <span className="text-sm font-semibold">{v.name || org.name}</span>
            </div>
            <div className="space-y-3 bg-slate-50 p-4">
              <div className="rounded-lg bg-brand/10 px-3 py-2 text-sm font-medium text-brand">Dashboard</div>
              <button type="button" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg">
                Approve milestone
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProfileCard() {
  const { user } = useMe();
  const { setSession } = useSession();
  const { toast } = useFeedback();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  const saveName = useMutation({
    mutationFn: () => api.patch<Session>('/auth/me', { name }),
    onSuccess: (s) => {
      setSession(s);
      toast('Profile updated');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const savePw = useMutation({
    mutationFn: () => api.patch<Session>('/auth/me', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast('Password changed');
    },
  });
  const pwFields = savePw.error instanceof ApiError ? (savePw.error.details ?? {}) : {};

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Your profile</h2>
      <p className="mt-1 text-sm text-slate-500">
        {user.email} · {roleLabel[user.role]}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveName.mutate();
          }}
        >
          <Input label="Display name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary" loading={saveName.isPending} disabled={name === user.name}>
            Save name
          </Button>
        </form>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            savePw.mutate();
          }}
        >
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            error={pwFields.currentPassword}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            error={pwFields.newPassword}
          />
          {savePw.error && !Object.keys(pwFields).length && <p className="text-sm text-red-600">{errorMessage(savePw.error)}</p>}
          <Button type="submit" variant="secondary" loading={savePw.isPending}>
            Change password
          </Button>
        </form>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { isAdmin } = useMe();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {isAdmin && <BrandingCard />}
        <ProfileCard />
      </div>
    </>
  );
}
