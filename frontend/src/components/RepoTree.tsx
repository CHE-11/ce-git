import Fuse from "fuse.js";
import { ArrowDownToLine, ArrowUpToLine, ChevronsDown, ChevronsUp, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { RepoStatus, TreeNode } from "../../../types/git";
import { cn } from "../lib/cn";
import type { FolderEditor } from "../lib/git-client";
import { countRemovedUnder, domId, filterRepoTree, hasNestedRepo, pathEquals, type RepoTreeFilter } from "../lib/tree";
import { Button } from "./Button";
import { Dialog } from "./Dialogs/Dialog";
import { RepoTreeFilterStat } from "./RepoTreeFilterStat";
import { RepoTreeNode } from "./RepoTreeNode";
import { TreeContextMenu } from "./TreeContextMenu";

const DEFAULT_WIDTH = 352;
const MIN_WIDTH = 224;
const MAX_WIDTH = 640;
const WIDTH_KEY = "ce-git.repo-tree-width";

function sidebarLimit() {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.6)));
}

function clampWidth(width: number) {
  return Math.min(sidebarLimit(), Math.max(MIN_WIDTH, Math.round(width)));
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

function collapsiblePaths(node: TreeNode): string[] {
  const nested = node.children.flatMap(collapsiblePaths);
  return node.children.length > 0 ? [node.path, ...nested] : nested;
}

function pathsBelowRoot(tree: TreeNode) {
  return tree.children.flatMap(collapsiblePaths);
}

function storeWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Ignore quota and private-mode failures; the width still applies for this session.
  }
}

type RepoTreeProps = {
  trees: TreeNode[];
  rootPaths: string[];
  statuses: Record<string, RepoStatus>;
  selectedPaths: string[];
  activePath: string | null;
  discovering: boolean;
  onSelect: (path: string, mode: "replace" | "toggle" | "range") => void;
  onSelectRepos: (paths: string[], selected: boolean) => void;
  selectedCount: number;
  onPullSelected: () => void;
  onPushSelected: () => void;
  onClearSelection: () => void;
  busy: boolean;
  removedRepos: string[];
  onOpenInEditor: (path: string, editor: FolderEditor) => void;
  onRevealInExplorer: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onRestoreRemoved: () => void;
  onAddRoot: () => void;
  repoCount: number;
  filter: RepoTreeFilter | null;
  onFilter: (filter: RepoTreeFilter | null) => void;
};

const filterEmpty: Record<RepoTreeFilter, string> = {
  dirty: "No repositories have uncommitted changes.",
  ahead: "No repositories are ahead of their upstream.",
  behind: "No repositories are behind their upstream.",
  unpublished: "Every repository already has a remote.",
  selected: "No repositories are selected.",
};

function treeHasRepos(tree: TreeNode) {
  return tree.kind === "repo" || tree.children.length > 0;
}

function collectRepos(node: TreeNode, repos: TreeNode[]) {
  if (node.kind === "repo") {
    repos.push(node);
  }
  for (const child of node.children) {
    collectRepos(child, repos);
  }
}

function pruneToSearch(node: TreeNode, matched: ReadonlySet<string>): TreeNode | null {
  const children: TreeNode[] = [];
  for (const child of node.children) {
    const next = pruneToSearch(child, matched);
    if (next) {
      children.push(next);
    }
  }
  const matches = node.kind === "repo" && matched.has(node.path);
  if (!matches && children.length === 0) {
    return null;
  }
  if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) {
    return node;
  }
  return { name: node.name, path: node.path, kind: node.kind, children };
}

function summarize(statuses: Record<string, RepoStatus>) {
  let dirty = 0;
  let ahead = 0;
  let behind = 0;
  let unpublished = 0;
  for (const status of Object.values(statuses)) {
    if (status.dirty) {
      dirty += 1;
    }
    ahead += status.ahead;
    behind += status.behind;
    if (status.github === null && !status.error) {
      unpublished += 1;
    }
  }
  return { dirty, ahead, behind, unpublished };
}

type TreeMenu = {
  node: TreeNode;
  x: number;
  y: number;
};

type TreeAction = {
  kind: "delete" | "remove";
  node: TreeNode;
};

export function RepoTree({
  trees,
  rootPaths,
  statuses,
  selectedPaths,
  activePath,
  discovering,
  onSelect,
  onSelectRepos,
  selectedCount,
  onPullSelected,
  onPushSelected,
  onClearSelection,
  busy,
  removedRepos,
  onOpenInEditor,
  onRevealInExplorer,
  onRemoveRepo,
  onDeleteFolder,
  onRestoreRemoved,
  filter,
  onFilter,
}: RepoTreeProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<TreeMenu | null>(null);
  const [pending, setPending] = useState<TreeAction | null>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  const moved = useRef(false);
  const visibleTrees = useMemo(
    () => trees.map((node) => (filter ? filterRepoTree(node, statuses, selectedPaths, filter) : node)),
    [trees, statuses, selectedPaths, filter],
  );
  const statusTrees = useMemo(
    () => (filter ? visibleTrees.filter(treeHasRepos) : trees),
    [filter, visibleTrees, trees],
  );
  const searchQuery = query.trim();
  const searchedTrees = useMemo(() => {
    if (!searchQuery) {
      return statusTrees;
    }
    const repos: TreeNode[] = [];
    for (const tree of statusTrees) {
      collectRepos(tree, repos);
    }
    const fuse = new Fuse(repos, {
      keys: ["name", "path"],
      threshold: 0.15,
      ignoreLocation: true,
    });
    const matched = new Set(fuse.search(searchQuery).map((result) => result.item.path));
    return statusTrees.flatMap((tree) => {
      const next = pruneToSearch(tree, matched);
      return next ? [next] : [];
    });
  }, [statusTrees, searchQuery]);
  const shownTrees = searchedTrees;
  const hasRepos = trees.some(treeHasRepos);
  const folderPaths = (filter ? visibleTrees : trees).flatMap(pathsBelowRoot);
  const allCollapsed = folderPaths.length > 0 && folderPaths.every((path) => collapsed[path]);
  const removedCount = countRemovedUnder(rootPaths, removedRepos);
  const summary = summarize(statuses);

  function toggleFilter(next: RepoTreeFilter) {
    onFilter(filter === next ? null : next);
  }
  const closeMenu = useCallback(() => setMenu(null), []);
  widthRef.current = width;

  useEffect(() => {
    setMenu(null);
  }, [trees, rootPaths, filter]);

  useEffect(() => {
    if (!filter && !searchQuery) {
      return;
    }
    setCollapsed({});
  }, [filter, searchQuery, rootPaths]);

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

  function toggleFolders() {
    if (folderPaths.length === 0) return;
    const collapsedNow = folderPaths.every((path) => collapsed[path]);
    setCollapsed(collapsedNow ? {} : Object.fromEntries(folderPaths.map((path) => [path, true])));
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
      commitWidth(sidebarLimit());
    }
  }

  return (
    <aside
      id="repo-tree-panel"
      style={{ width }}
      className="relative z-10 flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-950"
    >
      <form
        id="repo-tree-search"
        className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Search id="repo-tree-search-icon" className="size-3.5 shrink-0 text-zinc-500" />
        <input
          id="repo-tree-search-input"
          type="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repositories"
          aria-label="Search repositories"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        {query ? (
          <Button
            id="repo-tree-search-clear"
            variant="ghost"
            size="xs"
            className="h-6 px-1"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X id="repo-tree-search-clear-icon" className="size-3.5" />
          </Button>
        ) : null}
      </form>
      <div id="repo-tree-header" className="flex items-center justify-between px-3 py-2 h-10">
        {selectedCount > 0 ? (
          <>
            <span className="w-[22.4px]">
            </span>
            
            <div id="selection-actions" className="flex items-center gap-2 border-zinc-800">
              <Button id="pull-selected-button" variant="primary" size="xs" onClick={onPullSelected} disabled={busy}>
                <ArrowDownToLine id="pull-selected-icon" className="size-3.5" />
                <span id="pull-selected-label">Pull</span>
              </Button>
              <Button id="push-selected-button" variant="secondary" size="xs" onClick={onPushSelected} disabled={busy}>
                <ArrowUpToLine id="push-selected-icon" className="size-3.5" />
                <span id="push-selected-label">Push</span>
              </Button>
              <Button id="clear-selection-button" variant="destructive" size="xs" onClick={onClearSelection} disabled={busy}>
                <X id="clear-selection-icon" className="size-3.5" />
                <span id="clear-selection-label">Clear</span>
              </Button>
            </div>
          </>
        ) : (
          <div id="repo-tree-heading" className="flex min-w-0 flex-1 items-center">
            <h2 id="repo-tree-title" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Repositories
            </h2>
          </div>
        )}

        <Button
          id="repo-tree-collapse-button"
          variant="ghost"
          title={allCollapsed ? "Expand all" : "Collapse all"}
          aria-label={allCollapsed ? "Expand all" : "Collapse all"}
          disabled={trees.length === 0}
          onClick={toggleFolders}
          className="h-7 px-1.5"
        >
          {allCollapsed ? (
            <ChevronsDown id="repo-tree-collapse-icon" className="size-4" />
          ) : (
            <ChevronsUp id="repo-tree-collapse-icon" className="size-4" />
          )}
        </Button>
      </div>
      <div id="repo-tree-filters" className="flex flex-wrap items-center justify-between gap-0.5 border-b border-zinc-800 px-1.5 select-none h-6.75">
        <div className="flex flex-wrap items-center justify-center gap-0.5 select-none">
          <RepoTreeFilterStat
            id="repo-filter-dirty"
            label="Dirty"
            value={String(summary.dirty)}
            valueClassName={summary.dirty > 0 ? "text-amber-300" : undefined}
            pressed={filter === "dirty"}
            title="Show repositories with uncommitted changes"
            onClick={() => toggleFilter("dirty")}
          />
          <RepoTreeFilterStat
            id="repo-filter-ahead"
            label="Ahead"
            value={String(summary.ahead)}
            valueClassName={summary.ahead > 0 ? "text-emerald-300" : undefined}
            pressed={filter === "ahead"}
            title="Show repositories ahead of their upstream"
            onClick={() => toggleFilter("ahead")}
          />
          <RepoTreeFilterStat
            id="repo-filter-behind"
            label="Behind"
            value={String(summary.behind)}
            valueClassName={summary.behind > 0 ? "text-amber-300" : undefined}
            pressed={filter === "behind"}
            title="Show repositories behind their upstream"
            onClick={() => toggleFilter("behind")}
          />
          <RepoTreeFilterStat
            id="repo-filter-unpublished"
            label="Unpub."
            value={String(summary.unpublished)}
            valueClassName={summary.unpublished > 0 ? "text-violet-300" : undefined}
            pressed={filter === "unpublished"}
            title="Show repositories with no remote. Push creates a private GitHub repo when the GitHub CLI is available."
            onClick={() => toggleFilter("unpublished")}
          />

        </div>

        {filter ? (
          <Button id="repo-tree-filter-clear" className="ml-2" variant="destructive" size="xs" onClick={() => onFilter(null)}>
            Clear
          </Button>
        ) : null}
      </div>
      <div id="repo-tree-scroll" className="min-h-0 flex-1 overflow-auto pr-2 pb-3 pl-1">
        {rootPaths.length === 0 ? (
          <p id="repo-tree-empty" className="px-3 py-6 text-sm text-zinc-500">
            Add a folder to list every git repo inside it, including repos nested in other repos.
          </p>
        ) : discovering && trees.length === 0 ? (
          <p id="repo-tree-scanning" className="px-3 py-6 text-sm text-zinc-500">
            Scanning for repositories…
          </p>
        ) : shownTrees.length > 0 ? (
          <div id="repo-tree-roots" className="flex flex-col">
            {shownTrees.map((node, index) => (
              <div
                key={node.path}
                id={domId("tree-root", node.path)}
                className={index > 0 ? "mt-2 border-t border-zinc-800 pt-2" : undefined}
              >
                <RepoTreeNode
                  node={node}
                  rootPath={node.path}
                  depth={0}
                  statuses={statuses}
                  selectedPaths={selectedPaths}
                  activePath={activePath}
                  collapsed={collapsed}
                  contextPath={menu?.node.path ?? null}
                  filter={filter}
                  onToggle={(path) => setCollapsed((current) => ({ ...current, [path]: !current[path] }))}
                  onSelect={onSelect}
                  onSelectRepos={onSelectRepos}
                  onContextMenu={(next, x, y) => setMenu({ node: next, x, y })}
                />
              </div>
            ))}
          </div>
        ) : searchQuery && hasRepos ? (
          <p id="repo-tree-search-empty" className="px-3 py-6 text-sm text-zinc-500">
            No repositories match “{searchQuery}”.
          </p>
        ) : filter && hasRepos ? (
          <p id="repo-tree-filter-empty" className="px-3 py-6 text-sm text-zinc-500">
            {filterEmpty[filter]}
          </p>
        ) : (
          <div id="repo-tree-none-block" className="px-3 py-6">
            <p id="repo-tree-none" className="text-sm text-zinc-500">
              No git repositories under this folder.
            </p>
            {removedCount > 0 ? (
              <Button
                id="restore-removed-button"
                variant="ghost"
                className="mt-3 h-7 px-2 text-xs"
                onClick={onRestoreRemoved}
                disabled={busy}
              >
                <span id="restore-removed-button-label">Restore removed repos ({removedCount})</span>
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div
        id="repo-tree-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize repositories sidebar"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={sidebarLimit()}
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
          id="repo-tree-resizer-line"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-500 opacity-0 transition-opacity",
            dragging && "opacity-100",
            "group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        />
      </div>
      {menu ? (
        <TreeContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          rootPaths={rootPaths}
          removedCount={removedCount}
          actionsDisabled={busy || discovering}
          onOpen={(editor) => {
            const path = menu.node.path;
            setMenu(null);
            onOpenInEditor(path, editor);
          }}
          onReveal={() => {
            const path = menu.node.path;
            setMenu(null);
            onRevealInExplorer(path);
          }}
          onRemove={() => {
            setPending({ kind: "remove", node: menu.node });
            setMenu(null);
          }}
          onRestore={() => {
            setMenu(null);
            onRestoreRemoved();
          }}
          onDelete={() => {
            if (rootPaths.some((root) => pathEquals(menu.node.path, root))) {
              return;
            }
            setPending({ kind: "delete", node: menu.node });
            setMenu(null);
          }}
          onClose={closeMenu}
        />
      ) : null}
      {pending
        ? createPortal(
            <Dialog
              id={pending.kind === "delete" ? "delete-folder-dialog" : "remove-repo-dialog"}
              title={pending.kind === "delete" ? `Delete ${pending.node.name}` : `Remove ${pending.node.name}`}
              open
              onClose={() => setPending(null)}
            >
              {pending.kind === "delete" ? (
                <>
                  <p id="delete-folder-copy" className="text-sm text-zinc-300">
                    Move this folder to the Recycle Bin, including everything inside it.
                  </p>
                  <p id="delete-folder-path" className="mt-2 break-all font-mono text-xs text-zinc-500">
                    {pending.node.path}
                  </p>
                  <div id="delete-folder-actions" className="mt-4 flex justify-end gap-2">
                    <Button id="delete-folder-cancel" variant="ghost" onClick={() => setPending(null)}>
                      <span id="delete-folder-cancel-label">Cancel</span>
                    </Button>
                    <Button
                      id="delete-folder-confirm"
                      variant="primary"
                      className="bg-red-600 hover:bg-red-500"
                      disabled={busy}
                      onClick={() => {
                        const path = pending.node.path;
                        setPending(null);
                        onDeleteFolder(path);
                      }}
                    >
                      <span id="delete-folder-confirm-label">Delete</span>
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p id="remove-repo-copy" className="text-sm text-zinc-300">
                    Remove this repository from the list. Nothing is deleted.
                  </p>
                  {hasNestedRepo(pending.node) ? (
                    <p id="remove-repo-nested" className="mt-2 text-sm text-zinc-400">
                      Repositories nested inside it stay in the tree.
                    </p>
                  ) : null}
                  <p id="remove-repo-restore" className="mt-2 text-sm text-zinc-400">
                    Right-click the tree and choose Restore removed repos to show it again.
                  </p>
                  <p id="remove-repo-path" className="mt-2 break-all font-mono text-xs text-zinc-500">
                    {pending.node.path}
                  </p>
                  <div id="remove-repo-actions" className="mt-4 flex justify-end gap-2">
                    <Button id="remove-repo-cancel" variant="ghost" onClick={() => setPending(null)}>
                      <span id="remove-repo-cancel-label">Cancel</span>
                    </Button>
                    <Button
                      id="remove-repo-confirm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        const path = pending.node.path;
                        setPending(null);
                        onRemoveRepo(path);
                      }}
                    >
                      <span id="remove-repo-confirm-label">Remove repo</span>
                    </Button>
                  </div>
                </>
              )}
            </Dialog>,
            document.body,
          )
        : null}
    </aside>
  );
}
