import type { Request } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Validates input against a zod schema, throwing a 400 with field errors on failure. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    const first = Object.entries(fields)[0];
    throw badRequest(first ? `${first[0] === '_' ? '' : first[0] + ': '}${first[1]}` : 'Invalid input', fields);
  }
  return r.data;
}

export const param = (req: Request, name: string): string => {
  const v = req.params[name];
  if (typeof v !== 'string' || !v) throw badRequest(`Missing parameter ${name}`);
  return v;
};
