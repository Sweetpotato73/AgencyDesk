import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { env, isHttps, isProd } from './lib/env.js';
import { prisma } from './lib/db.js';
import { HttpError } from './lib/errors.js';
import { localStorageRouter, storage } from './lib/storage.js';
import { initRealtime } from './lib/realtime.js';
import { cleanupPendingUploads } from './lib/files.js';
import { stripeEnabled } from './lib/stripe.js';
import { emailEnabled } from './lib/mailer.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { orgRouter } from './routes/org.js';
import { clientsRouter } from './routes/clients.js';
import { projectsRouter } from './routes/projects.js';
import { milestonesRouter } from './routes/milestones.js';
import { tasksRouter } from './routes/tasks.js';
import { commentsRouter } from './routes/comments.js';
import { filesRouter } from './routes/files.js';
import { invoicesRouter, stripeWebhook } from './routes/invoices.js';
import { miscRouter } from './routes/misc.js';

const app = express();
app.set('trust proxy', 1);

const storageOrigin =
  env.STORAGE_DRIVER === 's3'
    ? env.S3_ENDPOINT
      ? new URL(env.S3_ENDPOINT).origin
      : 'https://*.amazonaws.com'
    : null;

app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:', ...(storageOrigin ? [storageOrigin] : [])],
            mediaSrc: ["'self'", 'blob:', ...(storageOrigin ? [storageOrigin] : [])],
            connectSrc: ["'self'", 'ws:', 'wss:', ...(storageOrigin ? [storageOrigin] : [])],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            formAction: ["'self'", 'https://checkout.stripe.com'],
            upgradeInsecureRequests: isHttps ? [] : null,
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);
app.use(cors({ origin: env.APP_URL, credentials: true }));

// Stripe needs the raw body to verify signatures, so this is registered before express.json().
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);
// Local-driver uploads stream the raw request body.
app.use('/api/storage/local', localStorageRouter());

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CSRF defence: state-changing API calls must carry a header a cross-site form can't set.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Missing X-Requested-With header' });
  }
  next();
});

app.use('/api', loadUser);

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, storage: storage.name, stripe: stripeEnabled, email: emailEnabled });
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/org', requireAuth, orgRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/invoices', requireAuth, invoicesRouter);
app.use('/api', requireAuth, milestonesRouter);
app.use('/api', requireAuth, tasksRouter);
app.use('/api', requireAuth, commentsRouter);
app.use('/api', requireAuth, filesRouter);
app.use('/api', requireAuth, miscRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production the API also serves the built React app.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'That already exists' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

async function main() {
  await prisma.$connect();
  await storage.init();
  const server = http.createServer(app);
  initRealtime(server);

  setInterval(() => cleanupPendingUploads().catch((e) => console.error('cleanup failed', e)), 3600_000).unref();

  server.listen(env.PORT, () => {
    console.log(`🚀 API ready on http://localhost:${env.PORT}`);
    console.log(`   storage=${storage.name} stripe=${stripeEnabled ? 'on' : 'off'} email=${emailEnabled ? 'on' : 'off'}`);
  });

  const shutdown = () => {
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
