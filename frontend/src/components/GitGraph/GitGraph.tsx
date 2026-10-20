import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphCommit, GraphRef, RepoGraph } from "../../../../types/git";
import { repoGraph } from "../../lib/git-client";
import {
  GRAPH_COLUMN_WIDTH,
  GRAPH_GUTTER,
  GRAPH_ROW_HEIGHT,
  graphColumnCount,
  layoutGraph,
  type GraphStroke,
} from "../../lib/git-graph";
import { cn } from "../../lib/cn";
import { Button } from "../Button";

const PAGE = 150;
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const WIDTH_KEY = "ce-git.git-graph-width";

const LANE_COLORS = ["#38bdf8", "#c084fc", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#a3e635", "#f472b6"];

type GitGraphProps = {
  path: string;
  refreshToken: string;
};

function paneLimit() {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.6)));
}

function clampWidth(width: number) {
  return Math.min(paneLimit(), Math.max(MIN_WIDTH, Math.round(width)));
}

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    const stored = Number(raw);
    if (Number.isFinite(stored)) return clampWidth(stored);
  } catch {
    // Private mode or a blocked storage API leaves the default width in place.
  }
  return DEFAULT_WIDTH;
}

function storeWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Ignore quota and private-mode failures; the width still applies for this session.
  }
}

function laneColor(index: number) {
  return LANE_COLORS[index % LANE_COLORS.length];
}

function columnX(column: number) {
  return GRAPH_GUTTER + column * GRAPH_COLUMN_WIDTH + GRAPH_COLUMN_WIDTH / 2;
}

function strokePath(stroke: GraphStroke) {
  const x1 = columnX(stroke.fromColumn);
  const x2 = columnX(stroke.toColumn);
  const y1 = stroke.fromY === "top" ? 0 : GRAPH_ROW_HEIGHT / 2;
  const y2 = stroke.toY === "mid" ? GRAPH_ROW_HEIGHT / 2 : GRAPH_ROW_HEIGHT;
  if (Math.abs(x1 - x2) < 0.5) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const bend = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`;
}

function errorText(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Couldn't load the commit graph.";
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const deltaSeconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (abs >= size || unit === "second") {
      return format.format(Math.round(deltaSeconds / size), unit);
    }
  }
  return iso;
}

function absoluteTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function matches(commit: GraphCommit, needle: string) {
  if (commit.subject.toLowerCase().includes(needle)) return true;
  if (commit.author.toLowerCase().includes(needle)) return true;
  if (commit.hash.toLowerCase().includes(needle)) return true;
  return commit.refs.some((ref) => ref.name.toLowerCase().includes(needle));
}

function refClass(kind: GraphRef["kind"]) {
  if (kind === "head") return "bg-violet-950 text-violet-200";
  if (kind === "branch") return "bg-sky-950 text-sky-300";
  if (kind === "tag") return "bg-amber-950 text-amber-200";
  return "bg-zinc-800 text-zinc-400";
}

function refToken(ref: GraphRef) {
  return `${ref.kind}-${ref.name}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function GitGraph({ path, refreshToken }: GitGraphProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState(path);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  const moved = useRef(false);
  widthRef.current = width;

  if (loadedPath !== path) {
    setLoadedPath(path);
    setLimit(PAGE);
    setGraph(null);
    setError(null);
    setQuery("");
    setSelectedHash(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repoGraph(path, limit)
      .then((result) => {
        if (cancelled) return;
        setGraph(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorText(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, limit, refreshToken]);

  useEffect(() => {
    function onResize() {
      setWidth((current) => clampWidth(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const previousCursor = style.cursor;
    const previousUserSelect = style.userSelect;
    style.cursor = "col-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = previousCursor;
      style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const rows = useMemo(() => layoutGraph(graph?.commits ?? []), [graph]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => (needle ? rows.filter((row) => matches(row.commit, needle)) : rows), [rows, needle]);
  const columns = graphColumnCount(rows);
  const laneWidth = GRAPH_GUTTER * 2 + columns * GRAPH_COLUMN_WIDTH;
  const selected = rows.find((row) => row.commit.hash === selectedHash)?.commit ?? null;
  const total = graph?.commits.length ?? 0;
  const countLabel = !graph ? "" : needle ? `${visible.length} of ${total}` : graph.truncated ? `${total}+ commits` : `${total} ${total === 1 ? "commit" : "commits"}`;

  function commitWidth(next: number) {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    storeWidth(clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, width: widthRef.current };
    moved.current = false;
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const next = clampWidth(dragStart.current.width + event.clientX - dragStart.current.x);
    if (Math.abs(event.clientX - dragStart.current.x) > 2) moved.current = true;
    widthRef.current = next;
    setWidth(next);
  }

  function finishDrag() {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    storeWidth(clampWidth(widthRef.current));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitWidth(widthRef.current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commitWidth(widthRef.current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitWidth(MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      commitWidth(paneLimit());
    }
  }

  return (
    <aside id="git-graph" style={{ width }} className="relative z-10 flex min-h-0 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <header id="git-graph-header" className="border-b border-zinc-800 px-2 py-2">
        <div id="git-graph-title-row" className="flex items-center justify-between gap-2">
          <h2 id="git-graph-title" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Graph
          </h2>
          <div id="git-graph-title-actions" className="flex items-center gap-2">
            {countLabel ? (
              <span id="git-graph-count" className="text-xs text-zinc-500">
                {countLabel}
              </span>
            ) : null}
            {graph?.truncated ? (
              <Button id="git-graph-load-more" variant="ghost" size="xs" disabled={loading} onClick={() => setLimit((current) => current + PAGE)}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        </div>
        <form id="git-graph-search" className="mt-1.5 flex items-center gap-1.5" onSubmit={(event) => event.preventDefault()}>
          <Search id="git-graph-search-icon" className="size-3.5 shrink-0 text-zinc-500" />
          <input
            id="git-graph-search-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commits"
            aria-label="Search commits"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <Button id="git-graph-search-clear" variant="ghost" size="xs" className="h-6 px-1" title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}>
              <X id="git-graph-search-clear-icon" className="size-3.5" />
            </Button>
          ) : null}
        </form>
      </header>
      {error ? (
        <p id="git-graph-error" className="border-b border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      <div id="git-graph-scroll" className="min-h-0 flex-1 overflow-auto">
        {loading && !graph ? (
          <p id="git-graph-loading" className="px-3 py-6 text-sm text-zinc-500">
            Loading history…
          </p>
        ) : graph && graph.commits.length === 0 ? (
          <p id="git-graph-empty" className="px-3 py-6 text-sm text-zinc-500">
            No commits yet.
          </p>
        ) : graph && visible.length === 0 ? (
          <p id="git-graph-none" className="px-3 py-6 text-sm text-zinc-500">
            No commits match.
          </p>
        ) : (
          visible.map((row) => {
            const commit = row.commit;
            const hash = commit.hash;
            const isHead = graph?.head === hash;
            const pressed = selectedHash === hash;
            return (
              <button
                id={`git-graph-row-${hash}`}
                key={hash}
                type="button"
                aria-pressed={pressed}
                title={commit.subject}
                onClick={() => setSelectedHash((current) => (current === hash ? null : hash))}
                className={cn(
                  "flex h-12 w-full min-w-0 items-center text-left hover:bg-zinc-900/70",
                  pressed && "bg-zinc-900",
                )}
              >
                <svg
                  id={`git-graph-lanes-${hash}`}
                  viewBox={`0 0 ${laneWidth} ${GRAPH_ROW_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="h-12 shrink-0"
                  style={{ width: `${laneWidth / 16}rem` }}
                  aria-hidden="true"
                >
                  {row.strokes.map((stroke, index) => (
                    <path
                      id={`git-graph-stroke-${hash}-${index}`}
                      key={`${stroke.fromColumn}-${stroke.toColumn}-${stroke.fromY}-${index}`}
                      d={strokePath(stroke)}
                      fill="none"
                      stroke={laneColor(stroke.color)}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  ))}
                  <circle
                    id={`git-graph-node-${hash}`}
                    cx={columnX(row.column)}
                    cy={GRAPH_ROW_HEIGHT / 2}
                    r={isHead ? 5 : 3.5}
                    fill={laneColor(row.color)}
                    stroke={isHead ? "#fafafa" : "#09090b"}
                    strokeWidth={isHead ? 2 : 1}
                  />
                </svg>
                <span id={`git-graph-body-${hash}`} className="flex min-w-0 flex-1 flex-col justify-center pr-3">
                  <span id={`git-graph-summary-${hash}`} className="flex min-w-0 items-center gap-1">
                    {commit.refs.length > 0 ? (
                      <span id={`git-graph-refs-${hash}`} className="flex shrink-0 items-center gap-1">
                        {commit.refs.map((ref) => (
                          <span
                            id={`git-graph-ref-${hash}-${refToken(ref)}`}
                            key={refToken(ref)}
                            className={cn("rounded px-1 py-px text-[0.625rem] leading-4 font-medium", refClass(ref.kind))}
                          >
                            {ref.kind === "head" && ref.name !== "HEAD" ? "HEAD" : ref.name}
                          </span>
                        ))}
                        {commit.refs
                          .filter((ref) => ref.kind === "head" && ref.name !== "HEAD")
                          .map((ref) => (
                            <span
                              id={`git-graph-ref-${hash}-branch-${refToken(ref)}`}
                              key={`branch-${ref.name}`}
                              className="rounded bg-sky-950 px-1 py-px text-[0.625rem] leading-4 font-medium text-sky-300"
                            >
                              {ref.name}
                            </span>
                          ))}
                      </span>
                    ) : null}
                    <span id={`git-graph-subject-${hash}`} className="min-w-0 flex-1 truncate text-sm leading-4 text-zinc-100">
                      {commit.subject || "(no message)"}
                    </span>
                  </span>
                  <span id={`git-graph-meta-${hash}`} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4 text-zinc-500">
                    <span id={`git-graph-author-${hash}`} className="truncate">
                      {commit.author || "Unknown"}
                    </span>
                    <span id={`git-graph-time-${hash}`} className="shrink-0" title={absoluteTime(commit.date)}>
                      {relativeTime(commit.date)}
                    </span>
                    <span id={`git-graph-hash-${hash}`} className="shrink-0 font-mono">
                      {hash.slice(0, 7)}
                    </span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
      {selected ? (
        <footer id="git-graph-detail" className="border-t border-zinc-800 px-3 py-2">
          <p id="git-graph-detail-subject" className="truncate text-sm text-zinc-100" title={selected.subject}>
            {selected.subject || "(no message)"}
          </p>
          <p id="git-graph-detail-hash" className="mt-1 truncate font-mono text-xs text-zinc-400" title={selected.hash}>
            {selected.hash}
          </p>
          <p id="git-graph-detail-parents" className="mt-1 truncate text-xs text-zinc-500">
            {selected.parents.length === 0 ? "No parents" : `Parents ${selected.parents.map((parent) => parent.slice(0, 7)).join(" ")}`}
          </p>
          <p id="git-graph-detail-author" className="truncate text-xs text-zinc-500">
            {selected.author || "Unknown"}
          </p>
          <p id="git-graph-detail-time" className="text-xs text-zinc-500">
            {absoluteTime(selected.date)}
          </p>
        </footer>
      ) : null}
      <div
        id="git-graph-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize commit graph"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={paneLimit()}
        aria-valuenow={width}
        tabIndex={0}
        className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onDoubleClick={() => {
          if (moved.current) return;
          commitWidth(DEFAULT_WIDTH);
        }}
        onKeyDown={onKeyDown}
      >
        <span
          id="git-graph-resizer-line"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-500 opacity-0 transition-opacity",
            dragging && "opacity-100",
            "group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        />
      </div>
    </aside>
  );
}
