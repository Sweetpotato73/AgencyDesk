export function fractionDigits(currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Formats an amount stored in the currency's smallest unit (e.g. cents). */
export function money(minor: number, currency = 'usd') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 10 ** fractionDigits(currency));
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export const toMinor = (major: number, currency: string) => Math.round(major * 10 ** fractionDigits(currency));
export const toMajor = (minor: number, currency: string) => minor / 10 ** fractionDigits(currency);

/** Due dates are stored as UTC midnight, so always format them in UTC. */
export function date(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

export function dateTime(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "YYYY-MM-DD" for <input type="date"> */
export const inputDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export function relative(d: string | Date) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)}d ago`;
  return date(d, { month: 'short', day: 'numeric' });
}

export function isOverdue(d: string | null | undefined) {
  if (!d) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(d) < today;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Picks black or white text for a given background hex color. */
export function readableOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.45 ? '#0f172a' : '#ffffff';
}
