import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown } from "lucide-react";
import type { BatchProgress } from "../../../types/git";
import { batchStatusLabel } from "../lib/batch-status";
import { cn } from "../lib/cn";
import { Button } from "./Button";

const COLLAPSED_KEY = "ce-git.activity-collapsed";
const HEIGHT_KEY = "ce-git.activity-height";
const DEFAULT_HEIGHT = 160;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 560;

function panelLimit() {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.6)));
}

function clampHeight(height: number) {
  return Math.min(panelLimit(), Math.max(MIN_HEIGHT, Math.round(height)));
}

function readStoredHeight() {
  try {
    const raw = localStorage.getItem(HEIGHT_KEY);
    if (raw === null) return DEFAULT_HEIGHT;
    const stored = Number(raw);
    if (Number.isFinite(stored)) return clampHeight(stored);
  } catch {
    // Private mode or a blocked storage API leaves the default height in place.
  }
  return DEFAULT_HEIGHT;
}

function storeHeight(height: number) {
  try {
    localStorage.setItem(HEIGHT_KEY, String(height));
  } catch {
    // Ignore quota and private-mode failures; the panel still resizes for this session.
  }
}

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

type Props = {
  logs: BatchProgress[];
  onClear: () => void;
};

const statusClass: Record<BatchProgress["status"], string> = {
  running: "text-zinc-400",
  ok: "text-emerald-400",
  skipped: "text-amber-400",
  failed: "text-red-400",
  conflict: "text-violet-300",
};

export function ActivityLog({ logs, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [height, setHeight] = useState(readStoredHeight);
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(height);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const moved = useRef(false);
  heightRef.current = height;

  useEffect(() => {
    function onResize() {
      setHeight((current) => clampHeight(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const previousCursor = style.cursor;
    const previousUserSelect = style.userSelect;
    style.cursor = "row-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = previousCursor;
      style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      storeCollapsed(next);
      return next;
    });
  }

  function commitHeight(next: number) {
    const clamped = clampHeight(next);
    heightRef.current = clamped;
    setHeight(clamped);
    storeHeight(clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { y: event.clientY, height: heightRef.current };
    moved.current = false;
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const next = clampHeight(dragStart.current.height + dragStart.current.y - event.clientY);
    if (Math.abs(event.clientY - dragStart.current.y) > 2) moved.current = true;
    heightRef.current = next;
    setHeight(next);
  }

  function finishDrag() {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    storeHeight(clampHeight(heightRef.current));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commitHeight(heightRef.current + step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commitHeight(heightRef.current - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitHeight(MIN_HEIGHT);
    } else if (event.key === "End") {
      event.preventDefault();
      commitHeight(panelLimit());
    }
  }

  return (
    <section
      id="batch-log"
      style={collapsed ? undefined : { height }}
      className={cn("relative flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-950", collapsed && "h-auto")}
    >
      {collapsed ? null : (
        <div
          id="batch-log-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize activity log"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={panelLimit()}
          aria-valuenow={height}
          tabIndex={0}
          className="group absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onDoubleClick={() => {
            if (moved.current) return;
            commitHeight(DEFAULT_HEIGHT);
          }}
          onKeyDown={onKeyDown}
        >
          <span
            id="batch-log-resizer-line"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sky-500 opacity-0 transition-opacity",
              dragging && "opacity-100",
              "group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
          />
        </div>
      )}
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
            Pull, push, publish, and commit results show up here.
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
                {batchStatusLabel(entry)}
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
