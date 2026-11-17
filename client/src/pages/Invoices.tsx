import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, CreditCard, Lock, Pencil, Plus, Printer, Receipt, Send, Trash2, XCircle } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { date, isOverdue, money, toMajor, toMinor } from '../lib/format';
import type { Client, Invoice, InvoiceStatus, ProjectSummary } from '../lib/types';
import { useMe } from '../context/session';
import { BrandMark, PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageLoader, Select, Spinner, Textarea, cx, invoiceStatus, useFeedback } from '../components/ui';

// ───────────────────────── List ─────────────────────────

export function InvoicesPage() {
  const { isStaff } = useMe();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['invoices', { status: filter }], queryFn: () => api.get<Invoice[]>(`/invoices${filter === 'ALL' ? '' : `?status=${filter}`}`) });
  const statuses: (InvoiceStatus | 'ALL')[] = isStaff ? ['ALL', 'DRAFT', 'OPEN', 'PAID', 'VOID'] : ['ALL', 'OPEN', 'PAID'];

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={isStaff ? 'Bill clients and get paid online' : 'View and pay your invoices'}
        actions={
          isStaff && (
            <Button icon={<Plus className="size-4" />} onClick={() => navigate('/invoices/new')}>
              New invoice
            </Button>
          )
        }
      />
      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cx('rounded-md px-3 py-1 text-xs font-medium', filter === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
          >
            {s === 'ALL' ? 'All' : invoiceStatus[s].label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt className="size-5" />} title="No invoices" description={isStaff ? 'Create an invoice and your client can pay it by card in one click.' : 'Invoices from the team will show up here.'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  {isStaff && <th className="px-5 py-3">Client</th>}
                  <th className="px-5 py-3">Issued</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((i) => {
                  const overdue = i.status === 'OPEN' && isOverdue(i.dueDate);
                  return (
                    <tr key={i.id} onClick={() => navigate(`/invoices/${i.id}`)} className="cursor-pointer hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`/invoices/${i.id}`} className="font-medium text-slate-900 hover:text-brand" onClick={(e) => e.stopPropagation()}>
                          {i.number}
                        </Link>
                        {i.project && <div className="text-xs text-slate-500">{i.project.name}</div>}
                      </td>
                      {isStaff && <td className="px-5 py-3 text-slate-600">{i.client.name}</td>}
                      <td className="px-5 py-3 text-slate-600">{i.issuedAt ? date(i.issuedAt) : '—'}</td>
                      <td className={cx('px-5 py-3', overdue ? 'font-medium text-red-600' : 'text-slate-600')}>{date(i.dueDate)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={overdue ? 'red' : invoiceStatus[i.status].tone}>{overdue ? 'Overdue' : invoiceStatus[i.status].label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold">{money(i.total, i.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

// ───────────────────────── Editor ─────────────────────────

interface Line {
  key: number;
  description: string;
  quantity: string;
  price: string; // major units, as typed
}

export function InvoiceEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { org } = useMe();
  const { toast } = useFeedback();
  const editing = Boolean(id);
  const nextKey = useRef(1);
  const line = (l?: Partial<Line>): Line => ({ key: nextKey.current++, description: '', quantity: '1', price: '', ...l });

  const existing = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/invoices/${id}`), enabled: editing });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api.get<Client[]>('/clients') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/projects') });

  const [v, setV] = useState({
    clientId: params.get('clientId') ?? '',
    projectId: params.get('projectId') ?? '',
    currency: org.currency,
    dueDate: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    notes: 'Thank you for your business!',
  });
  const [lines, setLines] = useState<Line[]>(() => [line()]);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    const inv = existing.data;
    if (!inv || loaded) return;
    if (inv.status !== 'DRAFT') {
      navigate(`/invoices/${inv.id}`, { replace: true });
      return;
    }
    setV({ clientId: inv.clientId, projectId: inv.projectId ?? '', currency: inv.currency, dueDate: inv.dueDate?.slice(0, 10) ?? '', notes: inv.notes });
    setLines(inv.items.map((it) => line({ description: it.description, quantity: String(it.quantity), price: String(toMajor(it.unitAmount, inv.currency)) })));
    setLoaded(true);
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = lines.map((l) => ({
    description: l.description.trim(),
    quantity: Math.max(1, Math.floor(Number(l.quantity) || 0)),
    unitAmount: toMinor(Number(l.price) || 0, v.currency),
  }));
  const total = items.reduce((s, i) => s + i.quantity * i.unitAmount, 0);

  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const body = { ...v, projectId: v.projectId || null, dueDate: v.dueDate || null, items };
      const inv = editing ? await api.patch<Invoice>(`/invoices/${id}`, body) : await api.post<Invoice>('/invoices', body);
      return send ? api.post<Invoice>(`/invoices/${inv.id}/send`) : inv;
    },
    onSuccess: (inv, send) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', inv.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(send ? `Invoice ${inv.number} sent to client` : `Draft ${inv.number} saved`);
      navigate(`/invoices/${inv.id}`, { replace: true });
    },
  });
  const fields = save.error instanceof ApiError ? (save.error.details ?? {}) : {};
  const clientProjects = projects.data?.filter((p) => p.client.id === v.clientId) ?? [];

  if (editing && !loaded) return existing.error ? <ErrorState error={existing.error} /> : <PageLoader />;

  return (
    <>
      <Link to={editing ? `/invoices/${id}` : '/invoices'} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <PageHeader title={editing ? `Edit ${existing.data?.number}` : 'New invoice'} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(false);
        }}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        <Card className="space-y-6 p-5 lg:col-span-2">
          {save.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(save.error)}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Client" required value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value, projectId: '' })} error={fields.clientId}>
              <option value="">Select a client…</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Project (optional)" value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })} disabled={!v.clientId}>
              <option value="">—</option>
              {clientProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input label="Due date" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
            <Input
              label="Currency"
              value={v.currency.toUpperCase()}
              maxLength={3}
              onChange={(e) => setV({ ...v, currency: e.target.value.toLowerCase() })}
              error={fields.currency}
              hint="ISO code, e.g. USD, EUR, GBP, SAR"
            />
          </div>

          <div>
            <div className="mb-2 hidden grid-cols-12 gap-3 px-1 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid">
              <span className="col-span-6">Description</span>
              <span className="col-span-2">Qty</span>
              <span className="col-span-2">Price</span>
              <span className="col-span-2 text-right">Amount</span>
            </div>
            <div className="space-y-3">
              {lines.map((l, idx) => {
                const amount = items[idx]!.quantity * items[idx]!.unitAmount;
                const upd = (p: Partial<Line>) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...p } : x)));
                return (
                  <div key={l.key} className="grid grid-cols-12 items-start gap-3 rounded-lg bg-slate-50 p-3 sm:bg-transparent sm:p-0">
                    <input
                      required
                      placeholder="Service or product"
                      value={l.description}
                      onChange={(e) => upd({ description: e.target.value })}
                      className="col-span-12 rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand sm:col-span-6"
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={l.quantity}
                      onChange={(e) => upd({ quantity: e.target.value })}
                      className="col-span-3 rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand sm:col-span-2"
                      aria-label="Quantity"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={l.price}
                      onChange={(e) => upd({ price: e.target.value })}
                      className="col-span-5 rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand sm:col-span-2"
                      aria-label="Unit price"
                    />
                    <div className="col-span-4 flex items-center justify-end gap-1 py-2 sm:col-span-2">
                      <span className="text-sm font-medium">{money(amount, v.currency)}</span>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button variant="ghost" size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, line()])}>
              Add line
            </Button>
          </div>

          <Textarea label="Notes / payment terms" rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-2xl font-semibold">{money(total, v.currency)}</span>
            </div>
            <div className="mt-5 space-y-2">
              <Button className="w-full" icon={<Send className="size-4" />} loading={save.isPending && save.variables === true} disabled={save.isPending || total <= 0} onClick={() => save.mutate(true)}>
                Save & send to client
              </Button>
              <Button type="submit" variant="secondary" className="w-full" loading={save.isPending && save.variables === false} disabled={save.isPending}>
                Save as draft
              </Button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Sent invoices notify the client's portal users and can be paid by card through Stripe.</p>
          </Card>
        </div>
      </form>
    </>
  );
}

// ───────────────────────── Detail / pay ─────────────────────────

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { org, isStaff, isAdmin, features } = useMe();
  const { toast, confirm } = useFeedback();
  const { data: inv, isLoading, error, refetch } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/invoices/${id}`) });

  const refresh = (msg?: string) => ({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (msg) toast(msg);
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
  });

  const pay = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/invoices/${id}/checkout`),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const send = useMutation({ mutationFn: () => api.post(`/invoices/${id}/send`), ...refresh('Invoice sent to client') });
  const voidIt = useMutation({ mutationFn: () => api.post(`/invoices/${id}/void`), ...refresh('Invoice voided') });
  const markPaid = useMutation({ mutationFn: () => api.post(`/invoices/${id}/mark-paid`), ...refresh('Marked as paid') });
  const remove = useMutation({
    mutationFn: () => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast('Draft deleted');
      navigate('/invoices');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  // Returning from Stripe Checkout: confirm the payment server-side.
  const payment = params.get('payment');
  const sessionId = params.get('session_id');
  const verify = useMutation({
    mutationFn: () => api.post<Invoice>(`/invoices/${id}/verify-payment`, { sessionId }),
    onSuccess: (data) => {
      qc.setQueryData(['invoice', id], data);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const verified = useRef(false);
  useEffect(() => {
    if (payment === 'success' && sessionId && !verified.current) {
      verified.current = true;
      verify.mutate();
    }
  }, [payment, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageLoader />;
  if (error || !inv) return <ErrorState error={error} onRetry={refetch} />;

  const overdue = inv.status === 'OPEN' && isOverdue(inv.dueDate);
  const dismiss = () => setParams({}, { replace: true });

  return (
    <>
      <Link to="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden">
        <ArrowLeft className="size-4" /> Invoices
      </Link>

      {payment === 'success' && (
        <div className={cx('mb-4 flex items-center gap-3 rounded-xl px-4 py-3 text-sm print:hidden', inv.status === 'PAID' ? 'bg-emerald-50 text-emerald-800' : 'bg-sky-50 text-sky-800')}>
          {inv.status === 'PAID' ? <CheckCircle2 className="size-5" /> : <Spinner className="size-5 text-sky-600" />}
          <span className="flex-1">{inv.status === 'PAID' ? 'Payment received — thank you!' : 'Confirming your payment…'}</span>
          <button onClick={dismiss} className="text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}
      {payment === 'cancelled' && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          <XCircle className="size-5" />
          <span className="flex-1">Payment was cancelled. You can try again any time.</span>
          <button onClick={dismiss} className="text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={
          <span className="flex items-center gap-2">
            <Badge tone={overdue ? 'red' : invoiceStatus[inv.status].tone}>{overdue ? 'Overdue' : invoiceStatus[inv.status].label}</Badge>
            {inv.paidAt && <span>Paid {date(inv.paidAt)}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print / PDF
            </Button>
            {isStaff && inv.status === 'DRAFT' && (
              <>
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => (await confirm({ title: 'Delete draft?', confirmLabel: 'Delete', danger: true })) && remove.mutate()}
                >
                  Delete
                </Button>
                <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/invoices/${inv.id}/edit`)}>
                  Edit
                </Button>
                <Button icon={<Send className="size-4" />} loading={send.isPending} onClick={() => send.mutate()}>
                  Send to client
                </Button>
              </>
            )}
            {isStaff && inv.status === 'OPEN' && (
              <>
                <Button
                  variant="ghost"
                  icon={<Ban className="size-4" />}
                  onClick={async () => (await confirm({ title: 'Void this invoice?', message: 'The client will no longer be able to pay it.', confirmLabel: 'Void invoice', danger: true })) && voidIt.mutate()}
                >
                  Void
                </Button>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    icon={<CheckCircle2 className="size-4" />}
                    onClick={async () => (await confirm({ title: 'Record payment?', message: 'Use this for bank transfers or other offline payments.', confirmLabel: 'Mark as paid' })) && markPaid.mutate()}
                  >
                    Mark paid
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 sm:p-8 lg:col-span-2 print:shadow-none print:ring-0">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <BrandMark name={org.name} logoUrl={org.logoUrl} />
              <div>
                <div className="font-semibold">{org.name}</div>
                <div className="text-sm text-slate-500">Invoice {inv.number}</div>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="text-slate-500">Amount {inv.status === 'PAID' ? 'paid' : 'due'}</div>
              <div className="text-2xl font-semibold">{money(inv.total, inv.currency)}</div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Billed to</div>
              <div className="mt-1 font-medium">{inv.client.name}</div>
              {inv.client.email && <div className="text-slate-500">{inv.client.email}</div>}
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Issued</div>
              <div className="mt-1">{inv.issuedAt ? date(inv.issuedAt) : 'Not sent yet'}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Due</div>
              <div className={cx('mt-1', overdue && 'font-medium text-red-600')}>{date(inv.dueDate)}</div>
            </div>
            {inv.project && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Project</div>
                <Link to={`/projects/${inv.project.id}`} className="mt-1 block hover:text-brand hover:underline print:no-underline">
                  {inv.project.name}
                </Link>
              </div>
            )}
          </div>

          <table className="mt-8 w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inv.items.map((it, i) => (
                <tr key={it.id ?? i}>
                  <td className="py-3 pr-4">{it.description}</td>
                  <td className="py-3 text-right text-slate-600">{it.quantity}</td>
                  <td className="py-3 text-right text-slate-600">{money(it.unitAmount, inv.currency)}</td>
                  <td className="py-3 text-right font-medium">{money(it.quantity * it.unitAmount, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td colSpan={3} className="py-3 text-right font-semibold">
                  Total
                </td>
                <td className="py-3 text-right text-base font-semibold">{money(inv.total, inv.currency)}</td>
              </tr>
            </tfoot>
          </table>
          {inv.notes && <p className="mt-6 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{inv.notes}</p>}
        </Card>

        <div className="space-y-4 print:hidden">
          {inv.status === 'OPEN' && (
            <Card className="p-5">
              <h3 className="font-semibold">Pay online</h3>
              <p className="mt-1 text-sm text-slate-500">Secure card payment powered by Stripe. You'll return here once it's done.</p>
              <Button className="mt-4 w-full" size="md" icon={<CreditCard className="size-4" />} loading={pay.isPending} disabled={!features.stripe} onClick={() => pay.mutate()}>
                Pay {money(inv.total, inv.currency)}
              </Button>
              {features.stripe ? (
                <p className="mt-3 flex items-center justify-center gap-1 text-xs text-slate-400">
                  <Lock className="size-3" /> Payments are processed securely by Stripe
                </p>
              ) : (
                <p className="mt-3 text-xs text-amber-700">
                  Online payments aren't enabled yet.{isStaff ? ' Add STRIPE_SECRET_KEY to the server .env to turn them on.' : ' Please contact the team for payment options.'}
                </p>
              )}
            </Card>
          )}
          {inv.status === 'PAID' && (
            <Card className="flex items-center gap-3 p-5 text-emerald-700">
              <CheckCircle2 className="size-8" />
              <div>
                <div className="font-semibold">Paid in full</div>
                <div className="text-sm text-emerald-600">{inv.paidAt && date(inv.paidAt)}</div>
              </div>
            </Card>
          )}
          {inv.status === 'VOID' && (
            <Card className="flex items-center gap-3 p-5 text-slate-500">
              <Ban className="size-6" />
              <div className="text-sm">This invoice was voided and no longer needs to be paid.</div>
            </Card>
          )}
          {inv.status === 'DRAFT' && (
            <Card className="p-5 text-sm text-slate-500">This is a draft. The client can't see it until you send it.</Card>
          )}
        </div>
      </div>
    </>
  );
}
