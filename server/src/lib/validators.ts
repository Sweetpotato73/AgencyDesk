import { z } from 'zod';

/** Accepts "YYYY-MM-DD" or a full ISO timestamp; null clears the value. */
export const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .refine((v) => v == null || v === '' || !Number.isNaN(Date.parse(v)), 'Invalid date')
  .transform((v) => (v == null || v === '' ? (v === undefined ? undefined : null) : new Date(v)));

export const id = z.string().min(1).max(64);
export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
export const password = z.string().min(8, 'Password must be at least 8 characters').max(200);
export const name = z.string().trim().min(1, 'Required').max(120);

export const userPublic = { id: true, name: true, email: true, role: true } as const;
