/**
 * Pluggable object storage.
 *
 *  - `s3`    AWS S3 / Cloudflare R2 / MinIO. The browser uploads straight to the bucket with a
 *            short-lived presigned PUT URL, downloads use presigned GET URLs. File bytes never
 *            pass through the API server.
 *  - `local` Files on the API server's disk, using the same "signed URL" flow so the frontend
 *            code is identical. Useful for development or single-server installs.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import jwt from 'jsonwebtoken';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Router, type Request, type Response } from 'express';
import { env } from './env.js';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageDriver {
  name: 's3' | 'local';
  init(): Promise<void>;
  createUploadUrl(key: string, contentType: string): Promise<UploadTarget>;
  createDownloadUrl(key: string, fileName: string, opts?: { inline?: boolean; contentType?: string }): Promise<string>;
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
}

/** Types that are safe to render inline in the browser (no script execution possible). */
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|wav|ogg|mp4)|text\/plain)$/;
export const canPreviewInline = (mime: string) => INLINE_SAFE.test(mime);

export const MAX_UPLOAD_BYTES = Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);
const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/** RFC 6266 / 5987 Content-Disposition that survives non-ASCII file names. */
export function contentDisposition(fileName: string, inline = false) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// ───────────────────────────── S3 / R2 / MinIO ─────────────────────────────

class S3Driver implements StorageDriver {
  name = 's3' as const;
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // R2 and MinIO don't support the newer default checksum headers on presigned PUTs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  async init() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch (err) {
      if (!env.S3_AUTO_CREATE_BUCKET) {
        throw new Error(`S3 bucket "${env.S3_BUCKET}" is not reachable: ${(err as Error).message}`);
      }
      await this.client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`🪣  Created bucket ${env.S3_BUCKET}`);
    }
    // Browsers upload directly to the bucket, so it needs CORS. Best effort: some providers
    // (e.g. MinIO, which is permissive by default) or limited tokens reject this call.
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: env.S3_BUCKET,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [env.APP_URL],
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch {
      /* configure CORS manually for your provider — see README */
    }
  }

  async createUploadUrl(key: string, contentType: string): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_TTL_SECONDS },
    );
    return { url, method: 'PUT', headers: { 'Content-Type': contentType } };
  }

  createDownloadUrl(key: string, fileName: string, opts: { inline?: boolean; contentType?: string } = {}) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: contentDisposition(fileName, opts.inline),
        ResponseContentType: opts.contentType,
      }),
      { expiresIn: DOWNLOAD_TTL_SECONDS },
    );
  }

  async stat(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return { size: r.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }
}

// ───────────────────────────── Local disk ─────────────────────────────

interface LocalToken {
  op: 'put' | 'get';
  key: string;
  ct?: string;
  name?: string;
  inline?: boolean;
}

class LocalDriver implements StorageDriver {
  name = 'local' as const;
  readonly root = path.resolve(env.LOCAL_UPLOAD_DIR);

  async init() {
    await fsp.mkdir(this.root, { recursive: true });
  }

  /** Resolve a key to a path inside root, refusing traversal. */
  pathFor(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  private sign(t: LocalToken, ttl: number) {
    return jwt.sign(t, env.JWT_SECRET + ':storage', { expiresIn: ttl });
  }

  verify(token: string): LocalToken | null {
    try {
      return jwt.verify(token, env.JWT_SECRET + ':storage') as LocalToken;
    } catch {
      return null;
    }
  }

  async createUploadUrl(key: string, contentType: string): Promise<UploadTarget> {
    const token = this.sign({ op: 'put', key, ct: contentType }, UPLOAD_TTL_SECONDS);
    return { url: `/api/storage/local/${token}`, method: 'PUT', headers: { 'Content-Type': contentType } };
  }

  async createDownloadUrl(key: string, fileName: string, opts: { inline?: boolean; contentType?: string } = {}) {
    const token = this.sign({ op: 'get', key, name: fileName, ct: opts.contentType, inline: opts.inline }, DOWNLOAD_TTL_SECONDS);
    return `/api/storage/local/${token}`;
  }

  async stat(key: string) {
    try {
      const s = await fsp.stat(this.pathFor(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await fsp.rm(this.pathFor(key), { force: true });
  }
}

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? new S3Driver() : new LocalDriver();

/** Routes that back the local driver's signed URLs. No-op router for S3. */
export function localStorageRouter() {
  const router = Router();
  if (!(storage instanceof LocalDriver)) return router;
  const driver = storage;

  router.put('/:token', async (req: Request, res: Response) => {
    const t = driver.verify(String(req.params.token));
    if (!t || t.op !== 'put') return res.status(403).json({ error: 'Upload link expired or invalid' });
    const dest = driver.pathFor(t.key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let written = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > MAX_UPLOAD_BYTES) cb(new Error('File too large'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(req, limiter, fs.createWriteStream(dest));
      res.status(200).end();
    } catch (err) {
      await fsp.rm(dest, { force: true });
      res.status(413).json({ error: (err as Error).message });
    }
  });

  router.get('/:token', async (req: Request, res: Response) => {
    const t = driver.verify(String(req.params.token));
    if (!t || t.op !== 'get') return res.status(403).json({ error: 'Download link expired or invalid' });
    const file = driver.pathFor(t.key);
    if (!(await driver.stat(t.key))) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', contentDisposition(t.name ?? path.basename(file), t.inline));
    if (t.ct) res.setHeader('Content-Type', t.ct);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Never let an uploaded document run scripts on our origin.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(file).pipe(res);
  });

  return router;
}
