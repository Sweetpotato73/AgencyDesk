import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { param } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import { brandOf } from './auth.js';

/** Unauthenticated endpoints used for white-label login pages. */
export const publicRouter = Router();

publicRouter.get('/orgs/:slug', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { slug: param(req, 'slug') } });
  if (!org) throw notFound('Workspace not found');
  res.json(brandOf(org));
});

publicRouter.get('/orgs/:slug/logo', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { slug: param(req, 'slug') } });
  if (!org?.logoKey) throw notFound('No logo');
  const url = await storage.createDownloadUrl(org.logoKey, 'logo', { inline: true });
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.redirect(302, url);
});
