import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isHttps } from './env.js';

export const COOKIE_NAME = 'portal_session';
const SESSION_DAYS = 14;

export interface SessionPayload {
  sub: string; // user id
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signSession(userId: string) {
  return jwt.sign({ sub: userId } satisfies SessionPayload, env.JWT_SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
    algorithm: 'HS256',
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    return typeof p === 'object' && typeof p.sub === 'string' ? { sub: p.sub } : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: string) {
  res.cookie(COOKIE_NAME, signSession(userId), {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Random URL-safe token + its SHA-256 hash (only the hash is stored). */
export function createToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Parses a single cookie value out of a raw Cookie header (used by Socket.IO). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
