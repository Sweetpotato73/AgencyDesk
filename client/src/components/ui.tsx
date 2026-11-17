import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { initials } from '../lib/format';
import type { InvoiceStatus, MilestoneStatus, ProjectStatus, Role, TaskStatus } from '../lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────────────────── Button ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:brightness-110 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ───────────────────────── Form fields ─────────────────────────

const fieldCls =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand disabled:bg-slate-50 disabled:text-slate-500';

export function Field({ label, error, hint, children, htmlFor }: { label?: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }>(
  function Input({ label, error, hint, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Field label={label} error={error} hint={hint} htmlFor={fid}>
        <input ref={ref} id={fid} className={cx(fieldCls, error && 'ring-red-400', className)} {...rest} />
      </Field>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; hint?: string }>(
  function Textarea({ label, error, hint, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Field label={label} error={error} hint={hint} htmlFor={fid}>
        <textarea ref={ref} id={fid} className={cx(fieldCls, 'min-h-20', error && 'ring-red-400', className)} {...rest} />
      </Field>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string }>(
  function Select({ label, error, hint, className, id, children, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Field label={label} error={error} hint={hint} htmlFor={fid}>
        <select ref={ref} id={fid} className={cx(fieldCls, 'pr-8', error && 'ring-red-400', className)} {...rest}>
          {children}
        </select>
      </Field>
    );
  },
);

// ───────────────────────── Display ─────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-slate-400', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-red-50 px-6 py-10 text-center text-sm text-red-700">
      <AlertTriangle className="size-6" />
      <p>{error instanceof Error ? error.message : 'Failed to load'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const avatarColors = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-teal-500', 'bg-orange-500'];
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const hash = [...name].reduce((h, c) => h + c.charCodeAt(0), 0);
  return (
    <span
      title={name}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        avatarColors[hash % avatarColors.length],
        size === 'xs' ? 'size-5 text-[9px]' : size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-xs',
        className,
      )}
    >
      {initials(name) || '?'}
    </span>
  );
}

export function Badge({ tone = 'slate', children, className }: { tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'brand'; children: ReactNode; className?: string }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    red: 'bg-red-50 text-red-700 ring-red-600/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    brand: 'bg-brand/10 text-brand ring-brand/20',
  };
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

export const milestoneStatus: Record<MilestoneStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  PENDING: { label: 'Not started', tone: 'slate' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'amber' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'red' },
  APPROVED: { label: 'Approved', tone: 'green' },
};
export const taskStatus: Record<TaskStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  TODO: { label: 'To do', tone: 'slate' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  IN_REVIEW: { label: 'In review', tone: 'violet' },
  DONE: { label: 'Done', tone: 'green' },
};
export const projectStatus: Record<ProjectStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  ACTIVE: { label: 'Active', tone: 'blue' },
  ON_HOLD: { label: 'On hold', tone: 'amber' },
  COMPLETED: { label: 'Completed', tone: 'green' },
};
export const invoiceStatus: Record<InvoiceStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  DRAFT: { label: 'Draft', tone: 'slate' },
  OPEN: { label: 'Unpaid', tone: 'amber' },
  PAID: { label: 'Paid', tone: 'green' },
  VOID: { label: 'Void', tone: 'red' },
};
export const roleLabel: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member', CLIENT: 'Client' };

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx(
            'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={cx('rounded-full px-1.5 text-xs', value === t.id ? 'bg-brand/10' : 'bg-slate-100')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Modal ─────────────────────────

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'animate-pop-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── Toasts & confirm ─────────────────────────

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}
interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

const FeedbackCtx = createContext<{
  toast: (message: string, kind?: ToastKind, action?: ToastItem['action']) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
} | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = 'success', action?: ToastItem['action']) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="animate-pop-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
            >
              {t.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              ) : t.kind === 'error' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-sky-400" />
              )}
              <div className="flex-1">
                <p>{t.message}</p>
                {t.action && (
                  <button
                    className="mt-1 font-semibold text-sky-300 hover:text-sky-200"
                    onClick={() => {
                      t.action!.onClick();
                      setToasts((x) => x.filter((y) => y.id !== t.id));
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-white" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
      <Modal
        open={Boolean(pending)}
        onClose={() => close(false)}
        title={pending?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {pending?.message && <p className="text-sm text-slate-600">{pending.message}</p>}
      </Modal>
    </FeedbackCtx.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider');
  return ctx;
}
