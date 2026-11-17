import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, File as FileIcon, FileArchive, FileImage, FileText, FileVideo, Trash2, UploadCloud, X } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { api } from '../../lib/api';
import { bytes, relative } from '../../lib/format';
import { openFile, uploadProjectFile } from '../../lib/upload';
import type { FileItem } from '../../lib/types';
import { useMe } from '../../context/session';
import { Avatar, cx, useFeedback } from '../ui';

interface UploadState {
  key: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
  controller: AbortController;
}

const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/|text\/plain)/;

export function fileIcon(mime: string, className = 'size-5') {
  if (mime.startsWith('image/')) return <FileImage className={cx(className, 'text-pink-500')} />;
  if (mime.startsWith('video/')) return <FileVideo className={cx(className, 'text-violet-500')} />;
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText className={cx(className, 'text-red-500')} />;
  if (/zip|compressed|tar|rar|7z/.test(mime)) return <FileArchive className={cx(className, 'text-amber-500')} />;
  return <FileIcon className={cx(className, 'text-slate-400')} />;
}

/** Drag & drop (or click) uploader with per-file progress. Files go straight to S3/R2. */
export function Dropzone({
  projectId,
  taskId,
  milestoneId,
  compact,
}: {
  projectId: string;
  taskId?: string | null;
  milestoneId?: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { features } = useMe();
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const depth = useRef(0);

  const patch = (key: string, p: Partial<UploadState>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const start = useCallback(
    async (files: File[]) => {
      const tooBig = files.filter((f) => f.size > features.maxUploadBytes);
      if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the ${bytes(features.maxUploadBytes)} limit`, 'error');
      const ok = files.filter((f) => f.size <= features.maxUploadBytes);
      const items = ok.map((f) => ({
        key: `${f.name}-${f.size}-${Math.random()}`,
        name: f.name,
        size: f.size,
        progress: 0,
        controller: new AbortController(),
        file: f,
      }));
      setUploads((u) => [...u, ...items.map(({ file: _f, ...rest }) => rest)]);

      // Upload up to 3 at a time.
      const queue = [...items];
      const worker = async () => {
        for (let it = queue.shift(); it; it = queue.shift()) {
          try {
            await uploadProjectFile(projectId, it.file, {
              taskId,
              milestoneId,
              signal: it.controller.signal,
              onProgress: (progress) => patch(it.key, { progress }),
            });
            setUploads((u) => u.filter((x) => x.key !== it.key));
          } catch (e) {
            patch(it.key, { error: errorMessage(e) });
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      if (taskId) qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
    [features.maxUploadBytes, milestoneId, projectId, qc, taskId, toast],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDrag(false);
    const files = [...e.dataTransfer.files];
    if (files.length) start(files);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setDrag(true);
        }}
        onDragLeave={() => {
          depth.current--;
          if (depth.current <= 0) setDrag(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition',
          compact ? 'px-4 py-4' : 'px-6 py-8',
          drag ? 'border-brand bg-brand/5' : 'border-slate-300 bg-white hover:border-brand/60 hover:bg-slate-50',
        )}
      >
        <UploadCloud className={cx(compact ? 'size-5' : 'size-8', drag ? 'text-brand' : 'text-slate-400')} />
        <p className={cx('mt-2 text-sm', compact && 'mt-1')}>
          <span className="font-semibold text-brand">Click to upload</span> <span className="text-slate-600">or drag and drop</span>
        </p>
        {!compact && <p className="mt-1 text-xs text-slate-500">Any file type up to {bytes(features.maxUploadBytes)}</p>}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) start(files);
          }}
        />
      </div>
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-2">
          {uploads.map((u) => (
            <li key={u.key} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{u.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  {u.error ? <span className="text-red-600">{u.error}</span> : `${u.progress}% · ${bytes(u.size)}`}
                  <button
                    onClick={() => {
                      u.controller.abort();
                      setUploads((x) => x.filter((y) => y.key !== u.key));
                    }}
                    className="rounded p-0.5 hover:bg-slate-100"
                    aria-label="Cancel upload"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </div>
              {!u.error && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand transition-all" style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FileList({ files, projectId, showContext, emptyText = 'No files yet' }: { files: FileItem[]; projectId: string; showContext?: boolean; emptyText?: string }) {
  const qc = useQueryClient();
  const { user, isStaff } = useMe();
  const { toast, confirm } = useFeedback();
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/files/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['task'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      toast('File deleted');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const open = (f: FileItem, inline: boolean) => openFile(f.id, inline).catch((e) => toast(errorMessage(e), 'error'));

  if (!files.length) return <p className="py-6 text-center text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {files.map((f) => (
        <li key={f.id} className="group flex items-center gap-3 py-2.5">
          <span className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100">{fileIcon(f.mimeType)}</span>
          <div className="min-w-0 flex-1">
            <button onClick={() => open(f, PREVIEWABLE.test(f.mimeType))} className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-brand hover:underline">
              {f.name}
            </button>
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
              <Avatar name={f.uploader.name} size="xs" />
              <span>{f.uploader.name}</span>
              <span>·</span>
              <span>{bytes(f.size)}</span>
              <span>·</span>
              <span>{relative(f.createdAt)}</span>
              {showContext && (f.task || f.milestone) && (
                <>
                  <span>·</span>
                  <span className="truncate">{f.task ? `Task: ${f.task.title}` : `Milestone: ${f.milestone!.title}`}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
            {PREVIEWABLE.test(f.mimeType) && (
              <button onClick={() => open(f, true)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Preview" aria-label="Preview">
                <Eye className="size-4" />
              </button>
            )}
            <button onClick={() => open(f, false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Download" aria-label="Download">
              <Download className="size-4" />
            </button>
            {(isStaff || f.uploader.id === user.id) && (
              <button
                onClick={async () => {
                  if (await confirm({ title: 'Delete file?', message: `“${f.name}” will be permanently deleted.`, confirmLabel: 'Delete', danger: true })) remove.mutate(f.id);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
