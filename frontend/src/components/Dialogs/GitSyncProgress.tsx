import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { BatchProgress, BatchStatus } from "../../../../types/git";
import { batchStatusLabel } from "../../lib/batch-status";
import { cn } from "../../lib/cn";

const statusClass: Record<BatchStatus, string> = {
  running: "text-zinc-400",
  ok: "text-emerald-400",
  skipped: "text-amber-400",
  failed: "text-red-400",
};

const logFilters: { status: BatchStatus; label: string; idleClass: string; activeClass: string }[] = [
  {
    status: "ok",
    label: "updated",
    idleClass: "text-emerald-400",
    activeClass: "border-emerald-500/70 bg-emerald-500/15 text-emerald-300",
  },
  {
    status: "skipped",
    label: "skipped",
    idleClass: "text-amber-400",
    activeClass: "border-amber-500/70 bg-amber-500/15 text-amber-300",
  },
  {
    status: "failed",
    label: "failed",
    idleClass: "text-red-400",
    activeClass: "border-red-500/70 bg-red-500/15 text-red-300",
  },
  {
    status: "running",
    label: "running",
    idleClass: "text-sky-300",
    activeClass: "border-sky-500/70 bg-sky-500/15 text-sky-200",
  },
];

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
  const [activeFilters, setActiveFilters] = useState<BatchStatus[]>([]);
  const finished = logs.filter((entry) => entry.status !== "running");
  const active = logs.filter((entry) => entry.status === "running");
  const counts: Record<BatchStatus, number> = {
    ok: finished.filter((entry) => entry.status === "ok").length,
    skipped: finished.filter((entry) => entry.status === "skipped").length,
    failed: finished.filter((entry) => entry.status === "failed").length,
    running: active.length,
  };
  const visibleLogs = activeFilters.length === 0 ? logs : logs.filter((entry) => activeFilters.includes(entry.status));
  const percent = total === 0 ? 0 : Math.min(100, Math.round((finished.length / total) * 100));
  const barClass = running ? "bg-sky-500" : counts.failed > 0 ? "bg-red-500" : "bg-emerald-500";
  const logSignature = visibleLogs.map((entry) => `${entry.repo}:${entry.status}:${entry.message}`).join("|");

  function toggleFilter(status: BatchStatus) {
    setActiveFilters((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  }

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [logSignature]);

  return (
    <div id={id}>
      <div
        id={`${id}-filters`}
        className="sticky -top-3 z-10 -mx-4 -mt-3 mb-3 flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/95 px-4 py-2 shadow-md backdrop-blur"
      >
        {logFilters.map((filter) => {
          const pressed = activeFilters.includes(filter.status);
          return (
            <button
              id={`${id}-filter-${filter.status}`}
              key={filter.status}
              type="button"
              aria-pressed={pressed}
              title={pressed ? `Stop filtering to ${filter.label}` : `Show ${filter.label} log lines`}
              onClick={() => toggleFilter(filter.status)}
              className={cn(
                "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-xs tabular-nums",
                pressed ? filter.activeClass : "border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:bg-zinc-800",
              )}
            >
              <span id={`${id}-filter-${filter.status}-label`} className={cn(!pressed && filter.idleClass)}>
                {counts[filter.status]} {filter.label}
              </span>
            </button>
          );
        })}
        {activeFilters.length > 0 ? (
          <button
            id={`${id}-filter-clear`}
            type="button"
            onClick={() => setActiveFilters([])}
            className="ml-auto h-6 cursor-pointer rounded-full px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Clear
          </button>
        ) : null}
      </div>
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
        ) : visibleLogs.length === 0 ? (
          <p id={`${id}-filter-empty`} className="text-zinc-500">
            No log lines match the selected filters.
          </p>
        ) : (
          visibleLogs.map((entry, index) => (
            <p id={`${id}-line-${index}`} key={`${entry.action}-${entry.repo}-${index}`} className="truncate py-0.5">
              <span id={`${id}-repo-${index}`} className="text-zinc-200">
                {entry.repo}
              </span>{" "}
              <span id={`${id}-state-${index}`} className={statusClass[entry.status]}>
                {batchStatusLabel(entry)}
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
