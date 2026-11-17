import { api } from './api';
import type { FileItem } from './types';

interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** PUT a blob to a presigned URL with progress reporting. */
export function putWithProgress(target: UploadTarget, file: Blob, onProgress?: (pct: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed — network error or storage CORS not configured'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** Full flow: register → upload straight to storage → confirm. */
export async function uploadProjectFile(
  projectId: string,
  file: File,
  opts: { taskId?: string | null; milestoneId?: string | null; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
) {
  const mimeType = file.type || 'application/octet-stream';
  const { fileId, upload } = await api.post<{ fileId: string; upload: UploadTarget }>(`/projects/${projectId}/files`, {
    name: file.name,
    size: file.size,
    mimeType,
    taskId: opts.taskId ?? null,
    milestoneId: opts.milestoneId ?? null,
  });
  await putWithProgress(upload, file, opts.onProgress, opts.signal);
  return api.post<FileItem>(`/files/${fileId}/complete`);
}

export async function openFile(fileId: string, inline: boolean) {
  // Open the tab synchronously (avoids popup blockers), then point it at the signed URL.
  const win = inline ? window.open('', '_blank') : null;
  try {
    const { url } = await api.get<{ url: string; inline: boolean }>(`/files/${fileId}/url${inline ? '?inline=1' : ''}`);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (e) {
    win?.close();
    throw e;
  }
}
