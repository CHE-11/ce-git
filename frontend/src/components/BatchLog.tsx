import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { BatchProgress } from "../../../types/git";
import { cn } from "../lib/cn";
import { Button } from "./Button";

const COLLAPSED_KEY = "ce-git.activity-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore quota and private-mode failures; the panel still toggles for this session.
  }
}

type BatchLogProps = {
  logs: BatchProgress[];
  onClear: () => void;
};

const statusClass: Record<BatchProgress["status"], string> = {
  running: "text-zinc-400",
  ok: "text-emerald-400",
  skipped: "text-amber-400",
  failed: "text-red-400",
};

export function BatchLog({ logs, onClear }: BatchLogProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      storeCollapsed(next);
      return next;
    });
  }

  return (
    <section
      id="batch-log"
      className={cn("flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-950", collapsed ? "h-auto" : "h-40")}
    >
      <div id="batch-log-header" className="flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 id="batch-log-title" className="min-w-0 flex-1">
          <button
            id="batch-log-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-controls="batch-log-scroll"
            onClick={toggle}
            className="inline-flex h-7 w-full items-center gap-1.5 rounded-md text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
          >
            <ChevronDown
              id="batch-log-toggle-icon"
              className={cn("size-3.5 shrink-0 transition-transform", collapsed && "-rotate-180")}
            />
            <span id="batch-log-title-label">Activity</span>
          </button>
        </h2>
        <Button id="clear-log-button" variant="ghost" onClick={onClear} className="h-7 px-2 text-xs">
          <span id="clear-log-label">Clear</span>
        </Button>
      </div>
      <div
        id="batch-log-scroll"
        hidden={collapsed}
        className="min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <p id="batch-log-empty" className="text-zinc-600">
            Pull, push, and commit results show up here.
          </p>
        ) : (
          logs.map((entry, index) => (
            <p id={`batch-log-line-${index}`} key={`${entry.action}-${entry.repo}-${index}`} className="truncate">
              <span id={`batch-log-action-${index}`} className="text-zinc-500">
                {entry.action}
              </span>{" "}
              <span id={`batch-log-repo-${index}`} className="text-zinc-200">
                {entry.repo}
              </span>{" "}
              <span id={`batch-log-status-${index}`} className={cn(statusClass[entry.status])}>
                {entry.status}
              </span>{" "}
              <span id={`batch-log-message-${index}`} className="text-zinc-400">
                {entry.message}
              </span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
