import { Search, X } from "lucide-react";
import type { GraphRef, RepoGraph } from "../../../../types/git";
import { cn } from "../../lib/cn";
import { GRAPH_COLUMN_WIDTH, GRAPH_GUTTER, GRAPH_ROW_HEIGHT, type GraphRow, type GraphStroke } from "../../lib/git-graph";
import { absoluteTime, relativeTime } from "../../lib/time";
import { Button } from "../Button";

const LANE_COLORS = ["#38bdf8", "#c084fc", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#a3e635", "#f472b6"];

type GitGraphTreeProps = {
  path: string | null;
  graph: RepoGraph | null;
  visible: GraphRow[];
  laneWidth: number;
  loading: boolean;
  error: string | null;
  countLabel: string;
  query: string;
  onQuery: (query: string) => void;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  onLoadMore: () => void;
};

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

function refClass(kind: GraphRef["kind"]) {
  if (kind === "head") return "bg-violet-950 text-violet-200";
  if (kind === "branch") return "bg-sky-950 text-sky-300";
  if (kind === "tag") return "bg-amber-950 text-amber-200";
  return "bg-zinc-800 text-zinc-400";
}

function refToken(ref: GraphRef) {
  return `${ref.kind}-${ref.name}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function GitGraphTree({
  path,
  graph,
  visible,
  laneWidth,
  loading,
  error,
  countLabel,
  query,
  onQuery,
  selectedHash,
  onSelect,
  onLoadMore,
}: GitGraphTreeProps) {
  return (
    <div id="git-graph-tree" className="flex min-h-0 flex-1 flex-col">
      <header id="git-graph-header" className="border-b border-zinc-800 px-2 py-2">
        <div id="git-graph-title-row" className="flex items-center justify-between gap-2">
          <h2 id="git-graph-title" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            History
          </h2>
          <div id="git-graph-title-actions" className="flex items-center gap-2">
            {countLabel ? (
              <span id="git-graph-count" className="text-xs text-zinc-500">
                {countLabel}
              </span>
            ) : null}
            {graph?.truncated ? (
              <Button id="git-graph-load-more" variant="ghost" size="xs" disabled={loading} onClick={onLoadMore}>
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
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search commits"
            aria-label="Search commits"
            disabled={!path}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <Button id="git-graph-search-clear" variant="ghost" size="xs" className="h-6 px-1" title="Clear search" aria-label="Clear search" onClick={() => onQuery("")}>
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
        {!path ? (
          <p id="git-graph-unselected" className="px-3 py-6 text-sm text-zinc-500">
            Select a repository to see its history.
          </p>
        ) : loading && !graph ? (
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
                onClick={() => onSelect(hash)}
                className={cn("flex h-12 w-full min-w-0 items-center text-left hover:bg-zinc-900/70", pressed && "bg-zinc-800/80 hover:bg-zinc-800/80")}
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
    </div>
  );
}
