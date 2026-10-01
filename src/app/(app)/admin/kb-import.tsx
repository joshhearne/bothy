"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Zip, ZipDeflate } from "fflate";
import { FileArchive, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/alert";
import { useLocale, useMessages } from "@/i18n/client";
import { formatBytes, formatNumber } from "@/i18n/format";

/**
 * The importer. A zip goes up as it is; anything else — a folder, a handful of
 * files — is packed into one here first, so the server only ever has one kind
 * of thing to unpack. It goes up in pieces, each small enough to pass whatever
 * proxy is in the way, and a piece that fails is sent again from where the
 * server says it got to.
 */

type Summary = {
  status: "uploading" | "running" | "done" | "failed";
  total: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  unextracted: number;
  ignored: number;
  images: number;
  used_manifest: boolean;
  failures: { path: string; reason: string }[];
  error: string | null;
};

type Phase =
  | { step: "idle" }
  | { step: "packing"; done: number; total: number }
  | { step: "uploading"; percent: number }
  | { step: "importing"; count: number }
  | { step: "finished"; summary: Summary };

const ACCEPT =
  ".zip,.md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,.avif,.heic,.heif,application/zip";
const ATTEMPTS = 4;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name);
}

/** Packs files into one archive, a file at a time so the page stays alive. */
async function pack(
  files: File[],
  onProgress: (done: number) => void,
  cancelled: () => boolean,
): Promise<Blob> {
  const parts: BlobPart[] = [];
  let failure: Error | null = null;

  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else parts.push(data as Uint8Array<ArrayBuffer>);
  });

  for (const [index, file] of files.entries()) {
    if (cancelled()) throw new Error("cancelled");

    const path = (file.webkitRelativePath || file.name).replace(/^\/+/, "");
    const entry = new ZipDeflate(path, { level: 6 });
    zip.add(entry);
    entry.push(new Uint8Array(await file.arrayBuffer()), true);

    if (failure) throw failure;
    onProgress(index + 1);
    // Lets the browser paint between files.
    if (index % 25 === 0) await wait(0);
  }

  zip.end();
  if (failure) throw failure;
  return new Blob(parts, { type: "application/zip" });
}

export function KbImport({ collectionId, maxMb }: { collectionId: string; maxMb: number }) {
  const t = useMessages();
  const locale = useLocale();
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);
  const uploadId = useRef<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // React has no prop for this, and a folder picker is what it takes.
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const busy = phase.step === "packing" || phase.step === "uploading" || phase.step === "importing";
  const size = files.reduce((sum, file) => sum + file.size, 0);
  const label =
    files.length === 1
      ? (files[0] as File).name
      : files[0]?.webkitRelativePath
        ? ((files[0] as File).webkitRelativePath.split("/")[0] ?? "")
        : `${formatNumber(files.length, locale)} files`;

  function choose(list: FileList | null) {
    setFiles(list ? [...list] : []);
    setError(null);
    setPhase({ step: "idle" });
  }

  async function send(id: string, blob: Blob, pieceBytes: number) {
    let offset = 0;
    let attempt = 0;

    while (offset < blob.size) {
      if (cancelled.current) throw new Error("cancelled");

      let response: Response | null = null;
      try {
        response = await fetch(`/api/kb/imports/${id}?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob.slice(offset, offset + pieceBytes),
        });
      } catch {
        // The network dropped; the same piece is sent again below.
      }

      if (response?.ok) {
        offset = ((await response.json()) as { received_bytes: number }).received_bytes;
        attempt = 0;
        setPhase({ step: "uploading", percent: Math.floor((offset / blob.size) * 100) });
        continue;
      }

      // The server says where it actually is: carry on from there.
      if (response?.status === 409) {
        const body = (await response.json()) as { error?: { received_bytes?: number } };
        if (typeof body.error?.received_bytes === "number") {
          offset = body.error.received_bytes;
          continue;
        }
      }

      attempt += 1;
      if (attempt >= ATTEMPTS || (response && response.status < 500 && response.status !== 408)) {
        throw new Error("upload");
      }
      await wait(1000 * 2 ** attempt);
    }
  }

  async function watch(id: string): Promise<Summary> {
    let misses = 0;
    for (;;) {
      await wait(1500);
      if (cancelled.current) throw new Error("cancelled");

      try {
        const response = await fetch(`/api/kb/imports/${id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("status");
        const summary = (await response.json()) as Summary;
        misses = 0;

        if (summary.status === "done" || summary.status === "failed") return summary;
        setPhase({ step: "importing", count: summary.total });
      } catch {
        misses += 1;
        if (misses > 20) throw new Error("upload");
      }
    }
  }

  async function start() {
    if (files.length === 0) {
      setError(t.admin.kb.nothingChosen);
      return;
    }

    cancelled.current = false;
    setError(null);

    try {
      const only = files.length === 1 ? (files[0] as File) : null;
      let blob: Blob;
      let filename: string;

      if (only && isZip(only)) {
        blob = only;
        filename = only.name;
      } else {
        setPhase({ step: "packing", done: 0, total: files.length });
        blob = await pack(
          files,
          (done) => setPhase({ step: "packing", done, total: files.length }),
          () => cancelled.current,
        );
        filename = `${label || "import"}.zip`;
      }

      if (blob.size > maxMb * 1024 * 1024) {
        setPhase({ step: "idle" });
        setError(t.admin.kb.tooLarge(maxMb));
        return;
      }

      setPhase({ step: "uploading", percent: 0 });
      const announced = await fetch("/api/kb/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          filename,
          size: blob.size,
          ...(category.trim() ? { category: category.trim() } : {}),
        }),
      });
      if (!announced.ok) {
        const body = (await announced.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ? `server:${body.error.message}` : "upload");
      }

      const { id, pieceBytes } = (await announced.json()) as { id: string; pieceBytes: number };
      uploadId.current = id;

      await send(id, blob, pieceBytes);

      const completed = await fetch(`/api/kb/imports/${id}/complete`, { method: "POST" });
      if (!completed.ok) {
        const body = (await completed.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ? `server:${body.error.message}` : "upload");
      }

      setPhase({ step: "importing", count: 0 });
      const summary = await watch(id);
      uploadId.current = null;

      setPhase({ step: "finished", summary });
      setFiles([]);
      if (filesInput.current) filesInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
      router.refresh();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setPhase({ step: "idle" });
      if (message === "cancelled") return;
      setError(message.startsWith("server:") ? message.slice(7) : t.admin.kb.uploadFailed);
    }
  }

  function cancel() {
    cancelled.current = true;
    const id = uploadId.current;
    uploadId.current = null;
    // Only an upload can be called off. An import that has begun runs on.
    if (id && phase.step === "uploading") {
      void fetch(`/api/kb/imports/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
    setPhase({ step: "idle" });
  }

  const progress =
    phase.step === "packing"
      ? { text: t.admin.kb.packing(phase.done, phase.total), value: phase.done / phase.total }
      : phase.step === "uploading"
        ? { text: t.admin.kb.uploading(phase.percent), value: phase.percent / 100 }
        : phase.step === "importing"
          ? { text: t.admin.kb.importing(phase.count), value: null }
          : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.importHint(maxMb)}</p>

      <FormError>{error}</FormError>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={filesInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => choose(event.target.files)}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => choose(event.target.files)}
        />

        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => filesInput.current?.click()}
        >
          <FileArchive className="size-4" aria-hidden />
          {t.admin.kb.chooseZip}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => folderInput.current?.click()}
        >
          <FolderOpen className="size-4" aria-hidden />
          {t.admin.kb.chooseFolder}
        </Button>
      </div>

      {files.length > 0 && (
        <p className="text-sm break-words">{t.admin.kb.chosen(label, formatBytes(size, locale))}</p>
      )}

      <div className="flex max-w-md flex-col gap-2">
        <label htmlFor="import-category" className="text-sm font-medium">
          {t.admin.kb.importCategory}
        </label>
        <input
          id="import-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          maxLength={200}
          disabled={busy}
          placeholder={files[0]?.webkitRelativePath?.split("/")[0] ?? ""}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <p className="text-xs text-[var(--muted-foreground)]">{t.admin.kb.importCategoryHint}</p>
      </div>

      {progress && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <p className="text-sm">{progress.text}</p>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className={
                progress.value === null
                  ? "h-full w-1/3 rounded-full bg-[var(--primary)] motion-safe:animate-pulse"
                  : "h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
              }
              style={progress.value === null ? undefined : { width: `${progress.value * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="button" disabled={busy || files.length === 0} onClick={() => void start()}>
          {t.admin.kb.start}
        </Button>
        {(phase.step === "packing" || phase.step === "uploading") && (
          <Button type="button" variant="ghost" onClick={cancel}>
            {t.admin.kb.cancel}
          </Button>
        )}
      </div>

      {phase.step === "finished" && <ImportSummary summary={phase.summary} />}
    </div>
  );
}

/** What an import did, in the four numbers that matter and the three that explain them. */
export function ImportSummary({ summary }: { summary: Summary }) {
  const t = useMessages();
  const locale = useLocale();

  const counts: [string, number][] = [
    [t.admin.kb.added, summary.added],
    [t.admin.kb.updated, summary.updated],
    [t.admin.kb.skipped, summary.skipped],
    [t.admin.kb.failed, summary.failed],
  ];
  const notes: [string, number][] = [
    [t.admin.kb.unextracted, summary.unextracted],
    [t.admin.kb.images, summary.images ?? 0],
    [t.admin.kb.ignored, summary.ignored],
  ];

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4" role="status">
      <p className="text-sm font-medium">
        {summary.status === "failed" ? t.admin.kb.failedRun : t.admin.kb.done}
      </p>
      {summary.error && <p className="text-sm text-[var(--destructive)]">{summary.error}</p>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(([name, value]) => (
          <div key={name} className="rounded-md bg-[var(--muted)] px-3 py-2">
            <dt className="text-xs text-[var(--muted-foreground)]">{name}</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatNumber(value, locale)}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-[var(--muted-foreground)]">
        {notes.map(([name, value]) => `${name}: ${formatNumber(value, locale)}`).join(" · ")}
        {summary.used_manifest ? ` · ${t.admin.kb.usedManifest}` : ""}
      </p>

      {summary.failures.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t.admin.kb.failures}</summary>
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-xs">
            {summary.failures.map((failure) => (
              <li key={failure.path} className="break-words">
                <code>{failure.path}</code> — {failure.reason}
              </li>
            ))}
          </ul>
          {summary.failed > summary.failures.length && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {t.admin.kb.moreFailures}
            </p>
          )}
        </details>
      )}
    </div>
  );
}
