import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { storage } from './storage.js';

/**
 * Runs a destructive DB operation that cascades to File rows, then removes the
 * corresponding objects from storage so nothing is orphaned in the bucket.
 */
export async function purgeStoredFiles(where: Prisma.FileWhereInput, op: () => Promise<unknown>) {
  const files = await prisma.file.findMany({ where, select: { storageKey: true } });
  await op();
  await Promise.allSettled(files.map((f) => storage.remove(f.storageKey)));
}

/** Deletes uploads that were started but never completed (abandoned browser tabs etc). */
export async function cleanupPendingUploads() {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  await purgeStoredFiles({ status: 'PENDING', createdAt: { lt: cutoff } }, () =>
    prisma.file.deleteMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } } }),
  );
}

export const filePublic = {
  id: true,
  name: true,
  size: true,
  mimeType: true,
  createdAt: true,
  projectId: true,
  taskId: true,
  milestoneId: true,
  uploader: { select: { id: true, name: true, role: true } },
} as const;
