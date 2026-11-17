import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { COOKIE_NAME, verifySession } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const session = verifySession(token);
    if (session) {
      const user = await prisma.user.findUnique({ where: { id: session.sub } });
      if (user && !user.deactivatedAt) req.user = user;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Staff = anyone at the agency (not a client). */
export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'CLIENT') return next(forbidden('Only agency staff can do this'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') return next(forbidden('Only admins can do this'));
  next();
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function me(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
