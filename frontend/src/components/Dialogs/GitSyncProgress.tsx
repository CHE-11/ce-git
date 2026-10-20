import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { BatchProgress } from "../../../../types/git";
import { cn } from "../../lib/cn";

const statusClass: Record<BatchProgress["status"], string> = {
  running: "text-zinc-400",
  ok: "text-emerald-400",
  skipped: "text-amber-400",
  failed: "text-red-400",
};

type GitSyncProgressProps = {
  id: string;
  label: string;
  total: number;
  logs: BatchProgress[];
  running: boolean;
  error: string | null;
};

export function GitSyncProgress({ id, label, total, logs, running, error }: GitSyncProgressProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const finished = logs.filter((entry) => entry.status !== "running");
  const active = logs.filter((entry) => entry.status === "running");
  const updated = finished.filter((entry) => entry.status === "ok").length;
  const skipped = finished.filter((entry) => entry.status === "skipped").length;
  const failed = finished.filter((entry) => entry.status === "failed").length;
  const percent = total === 0 ? 0 : Math.min(100, Math.round((finished.length / total) * 100));
  const barClass = running ? "bg-sky-500" : failed > 0 ? "bg-red-500" : "bg-emerald-500";
  const logSignature = logs.map((entry) => `${entry.repo}:${entry.status}:${entry.message}`).join("|");

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [logSignature]);

  return (
    <div id={id}>
      <div id={`${id}-summary`} className="flex items-center justify-between gap-3 text-sm text-zinc-200">
        <p id={`${id}-status`} aria-live="polite" className="flex min-w-0 items-center gap-2">
          {running ? <Loader2 id={`${id}-spinner`} className="size-3.5 shrink-0 animate-spin text-sky-300" /> : null}
          <span id={`${id}-status-label`} className="truncate">
            {running ? `${label} ${finished.length} of ${total}` : `Finished ${finished.length} of ${total}`}
          </span>
        </p>
        <span id={`${id}-percent`} className="shrink-0 tabular-nums text-zinc-400">
          {percent}%
        </span>
      </div>
      <div
        id={`${id}-bar`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={finished.length}
        aria-label={label}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          id={`${id}-bar-fill`}
          className={cn("h-full transition-[width] duration-200", barClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p id={`${id}-counts`} className="mt-2 text-xs text-zinc-400">
        <span id={`${id}-updated`} className="text-emerald-400">
          {updated} updated
        </span>
        <span id={`${id}-counts-sep-1`}> · </span>
        <span id={`${id}-skipped`} className="text-amber-400">
          {skipped} skipped
        </span>
        <span id={`${id}-counts-sep-2`}> · </span>
        <span id={`${id}-failed`} className="text-red-400">
          {failed} failed
        </span>
      </p>
      {active.length > 0 ? (
        <p id={`${id}-active`} className="mt-2 truncate text-xs text-zinc-400">
          Working on {active.map((entry) => entry.repo).join(", ")}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-sm wrap-break-word text-red-300">
          {error}
        </p>
      ) : null}
      <div
        id={`${id}-log`}
        ref={listRef}
        className="mt-3 max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <p id={`${id}-empty`} className="text-zinc-500">
            {running ? "Starting…" : "No repositories were processed."}
          </p>
        ) : (
          logs.map((entry, index) => (
            <p id={`${id}-line-${index}`} key={`${entry.action}-${entry.repo}-${index}`} className="truncate py-0.5">
              <span id={`${id}-repo-${index}`} className="text-zinc-200">
                {entry.repo}
              </span>{" "}
              <span id={`${id}-state-${index}`} className={statusClass[entry.status]}>
                {entry.status}
              </span>{" "}
              <span id={`${id}-message-${index}`} className="text-zinc-400">
                {entry.message}
              </span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}
