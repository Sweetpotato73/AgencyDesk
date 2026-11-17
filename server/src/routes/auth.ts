import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import {
  clearSessionCookie,
  hashPassword,
  hashToken,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { parse, param } from '../lib/http.js';
import { email, name, password } from '../lib/validators.js';
import { me, requireAuth } from '../middleware/auth.js';
import { stripeEnabled } from '../lib/stripe.js';
import { storage, MAX_UPLOAD_BYTES } from '../lib/storage.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in a few minutes' },
  skip: () => process.env.NODE_ENV === 'test',
});

const dummyHash = hashPassword('timing-equaliser');

export function brandOf(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    brandColor: org.brandColor,
    currency: org.currency,
    logoUrl: org.logoKey ? `/api/public/orgs/${org.slug}/logo?v=${org.logoKey.slice(-8)}` : null,
  };
}

async function sessionPayload(user: User) {
  const [org, client] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
    user.clientId ? prisma.client.findUnique({ where: { id: user.clientId }, select: { id: true, name: true } }) : null,
  ]);
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, clientId: user.clientId },
    org: brandOf(org),
    client,
    features: { stripe: stripeEnabled, storage: storage.name, maxUploadBytes: MAX_UPLOAD_BYTES },
  };
}

async function uniqueSlug(base: string) {
  const root =
    base
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agency';
  for (let i = 0; ; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await prisma.organization.findUnique({ where: { slug } }))) return slug;
  }
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(
    z.object({ agencyName: name, name, email, password }),
    req.body,
  );
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('An account with this email already exists');
  }
  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: body.agencyName, slug: await uniqueSlug(body.agencyName) },
    });
    return tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: 'OWNER',
        orgId: org.id,
      },
    });
  });
  setSessionCookie(res, user.id);
  res.status(201).json(await sessionPayload(user));
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1, 'Required') }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Always run bcrypt to keep timing similar whether or not the user exists.
  const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  setSessionCookie(res, user.id);
  res.json(await sessionPayload(user));
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Like /me but returns null instead of 401 when signed out (used on app boot). */
authRouter.get('/session', async (req, res) => {
  res.json(req.user ? await sessionPayload(req.user) : null);
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await sessionPayload(me(req)));
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const user = me(req);
  const body = parse(
    z.object({
      name: name.optional(),
      currentPassword: z.string().optional(),
      newPassword: password.optional(),
    }),
    req.body,
  );
  const data: { name?: string; passwordHash?: string } = {};
  if (body.name) data.name = body.name;
  if (body.newPassword) {
    if (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    data.passwordHash = await hashPassword(body.newPassword);
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  res.json(await sessionPayload(updated));
});

async function findInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: true, client: { select: { name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw notFound('This invitation link is invalid or has expired');
  }
  return invite;
}

authRouter.get('/invite/:token', async (req, res) => {
  const invite = await findInvite(param(req, 'token'));
  res.json({
    email: invite.email,
    role: invite.role,
    clientName: invite.client?.name ?? null,
    org: brandOf(invite.org),
  });
});

authRouter.post('/accept-invite', authLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), name, password }), req.body);
  const invite = await findInvite(body.token);
  if (await prisma.user.findUnique({ where: { email: invite.email } })) {
    throw conflict('An account with this email already exists. Please sign in instead.');
  }
  const user = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw notFound('This invitation has already been used');
    return tx.user.create({
      data: {
        email: invite.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: invite.role,
        orgId: invite.orgId,
        clientId: invite.role === 'CLIENT' ? invite.clientId : null,
      },
    });
  });
  setSessionCookie(res, user.id);
  res.status(201).json(await sessionPayload(user));
});
