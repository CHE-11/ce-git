import { useEffect, useMemo, useState } from "react";
import type { GraphCommit, RepoGraph } from "../../../../types/git";
import { repoGraph } from "../../lib/git-client";
import { GRAPH_COLUMN_WIDTH, GRAPH_GUTTER, graphColumnCount, layoutGraph } from "../../lib/git-graph";
import { useResizableWidth } from "../../lib/use-resizable-width";
import { PaneResizer } from "../PaneResizer";
import { GitGraphDetails } from "./GitGraphDetails";
import { GitGraphTree } from "./GitGraphTree";

const PAGE = 150;

type GitGraphProps = {
  path: string;
  refreshToken: string;
};

function errorText(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Couldn't load the commit graph.";
}

function matches(commit: GraphCommit, needle: string) {
  if (commit.subject.toLowerCase().includes(needle)) return true;
  if (commit.author.toLowerCase().includes(needle)) return true;
  if (commit.hash.toLowerCase().includes(needle)) return true;
  return commit.refs.some((ref) => ref.name.toLowerCase().includes(needle));
}

export function GitGraph({ path, refreshToken }: GitGraphProps) {
  const treePane = useResizableWidth({
    storageKey: "ce-git.git-graph-width",
    defaultWidth: 520,
    minWidth: 320,
    maxWidth: 1400,
    maxFraction: 0.7,
  });
  const [limit, setLimit] = useState(PAGE);
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState(path);

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

  const rows = useMemo(() => layoutGraph(graph?.commits ?? []), [graph]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => (needle ? rows.filter((row) => matches(row.commit, needle)) : rows), [rows, needle]);
  const columns = graphColumnCount(rows);
  const laneWidth = GRAPH_GUTTER * 2 + columns * GRAPH_COLUMN_WIDTH;
  const selected =
    rows.find((row) => row.commit.hash === selectedHash)?.commit ??
    rows.find((row) => row.commit.hash === graph?.head)?.commit ??
    rows[0]?.commit ??
    null;
  const total = graph?.commits.length ?? 0;
  const countLabel = !graph ? "" : needle ? `${visible.length} of ${total}` : graph.truncated ? `${total}+ commits` : `${total} ${total === 1 ? "commit" : "commits"}`;

  return (
    <section id="git-graph" className="flex min-h-0 min-w-0 flex-1">
      <aside id="git-graph-tree-pane" style={{ width: treePane.width }} className="relative flex min-h-0 shrink-0 flex-col border-r border-zinc-800">
        <GitGraphTree
          path={path}
          graph={graph}
          visible={visible}
          laneWidth={laneWidth}
          loading={loading}
          error={error}
          countLabel={countLabel}
          query={query}
          onQuery={setQuery}
          selectedHash={selected?.hash ?? null}
          onSelect={setSelectedHash}
          onLoadMore={() => setLimit((current) => current + PAGE)}
        />
        <PaneResizer id="git-graph-resizer" label="Resize commit graph" resizable={treePane} />
      </aside>
      <GitGraphDetails path={path} commit={selected} />
    </section>
  );
}
