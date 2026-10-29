import Fuse from "fuse.js";
import { ChevronsDown, ChevronsUp, Search, X } from "lucide-react";
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
import type { RepoStatus, TreeNode } from "../../../../types/git";
import { cn } from "../../lib/cn";
import type { EditorId } from "../../lib/editors";
import { countRemovedUnder, domId, filterRepoTree, hasNestedRepo, pathEquals, type RepoTreeFilter } from "../../lib/tree";
import { folderColorMode, folderColorVars, type TreeStyle } from "../../lib/tree-style";
import { Button } from "../Button";
import { Dialog } from "../Dialogs/Dialog";
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
  activePath: string | null;
  discovering: boolean;
  onOpen: (path: string) => void;
  onViewRepo: (path: string) => void;
  busy: boolean;
  removedRepos: string[];
  onOpenInEditor: (path: string, editor: EditorId) => void;
  onOpenGitignore: (path: string, editor: EditorId) => void;
  menuEditors: readonly EditorId[];
  onOpenInTerminal: (path: string) => void;
  onRevealInExplorer: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onRestoreRemoved: () => void;
  onAddRoot: () => void;
  filter: RepoTreeFilter | null;
  onFilter: (filter: RepoTreeFilter | null) => void;
  treeStyle: TreeStyle;
};

const filterEmpty: Record<RepoTreeFilter, string> = {
  selected: "No repositories are selected.",
  dirty: "No repositories have uncommitted changes.",
  ahead: "No repositories are ahead of their upstream.",
  behind: "No repositories are behind their upstream.",
  unpublished: "Every repository already has a remote.",
};

function treeHasRepos(tree: TreeNode) {
  return tree.kind === "repo" || tree.children.length > 0;
}

function foldersWithDirtyRepos(node: TreeNode, statuses: Record<string, RepoStatus>, dirty: Set<string>): boolean {
  let containsDirty = node.kind === "repo" && statuses[node.path]?.dirty === true;
  for (const child of node.children) {
    if (foldersWithDirtyRepos(child, statuses, dirty)) {
      containsDirty = true;
    }
  }
  if (containsDirty && node.kind === "folder") {
    dirty.add(node.path);
  }
  return containsDirty;
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
  activePath,
  discovering,
  onOpen,
  onViewRepo,
  busy,
  removedRepos,
  onOpenInEditor,
  onOpenGitignore,
  menuEditors,
  onOpenInTerminal,
  onRevealInExplorer,
  onRemoveRepo,
  onDeleteFolder,
  onRestoreRemoved,
  filter,
  onFilter,
  treeStyle,
}: RepoTreeProps) {

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<TreeMenu | null>(null);
  const [pending, setPending] = useState<TreeAction | null>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  const moved = useRef(false);
  const searchQuery = query.trim();
  const activeFilter = searchQuery ? null : filter;
  const shownTrees = useMemo(() => {
    if (searchQuery) {
      const repos: TreeNode[] = [];
      for (const tree of trees) {
        collectRepos(tree, repos);
      }
      const fuse = new Fuse(repos, {
        keys: ["name", "path"],
        threshold: 0.15,
        ignoreLocation: true,
      });
      const matched = new Set(fuse.search(searchQuery).map((result) => result.item.path));
      return trees.flatMap((tree) => {
        const next = pruneToSearch(tree, matched);
        return next ? [next] : [];
      });
    }
    if (filter) {
      return trees.map((node) => filterRepoTree(node, statuses, [], filter)).filter(treeHasRepos);
    }
    return trees;
  }, [trees, statuses, filter, searchQuery]);
  const dirtyFolders = useMemo(() => {
    const dirty = new Set<string>();
    for (const tree of trees) {
      foldersWithDirtyRepos(tree, statuses, dirty);
    }
    return dirty;
  }, [trees, statuses]);
  const colorMode = folderColorMode(treeStyle);
  const folderVars = useMemo(() => {
    if (!colorMode) {
      return null;
    }
    const unique = colorMode === "background" ? treeStyle.folderColorBackgroundUnique : treeStyle.folderFontColorUnique;
    return folderColorVars(trees, unique);
  }, [trees, colorMode, treeStyle.folderColorBackgroundUnique, treeStyle.folderFontColorUnique]);
  const hasRepos = trees.some(treeHasRepos);
  const folderPaths = shownTrees.flatMap(pathsBelowRoot);
  const defaultCollapsed = !activeFilter && !searchQuery;
  const rootsCollapsible = rootPaths.length > 1;
  const collapsedView = defaultCollapsed
    ? { ...Object.fromEntries(folderPaths.map((path) => [path, true])), ...collapsed }
    : Object.fromEntries(folderPaths.map((path) => [path, false]));
  if (!rootsCollapsible) {
    for (const tree of trees) {
      collapsedView[tree.path] = false;
    }
  }
  const allCollapsed = folderPaths.length > 0 && folderPaths.every((path) => collapsedView[path]);
  const removedCount = countRemovedUnder(rootPaths, removedRepos);
  const summary = summarize(statuses);

  function toggleFilter(next: RepoTreeFilter) {
    if (filter === next && !searchQuery) {
      onFilter(null);
      return;
    }
    setQuery("");
    onFilter(next);
  }
  const closeMenu = useCallback(() => setMenu(null), []);
  widthRef.current = width;

  useEffect(() => {
    setMenu(null);
  }, [trees, rootPaths, filter]);

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
    const collapsedNow = folderPaths.every((path) => collapsedView[path]);
    setCollapsed(Object.fromEntries(folderPaths.map((path) => [path, !collapsedNow])));
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

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim() && filter) {
      onFilter(null);
    }
  }

  function handleClearSearch() {
    setQuery("");
    searchInputRef.current?.focus();
  }

  function handleClearFilter() {
    onFilter(null);
  }

  return (
    <aside
      id="repo-tree-panel"
      style={{ width }}
      className="relative z-10 flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-950"
    >
      <form
        id="repo-tree-search"
        autoComplete="off"
        className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Search id="repo-tree-search-icon" className="size-3.5 shrink-0 text-zinc-500" />
        <input
          ref={searchInputRef}
          id="repo-tree-search-input"
          type="input"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search repositories"
          aria-label="Search repositories"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        {query ? (
          <Button id="repo-tree-search-clear" variant="ghost" size="sm" title="Clear search" aria-label="Clear search" onClick={handleClearSearch}>
            <X id="repo-tree-search-clear-icon" size={20} className="shrink-0 text-zinc-500" />
          </Button>
        ) : null}
      </form>

      <div id="repo-tree-filters" className="flex flex-wrap items-center justify-between gap-0.5 border-b border-zinc-800 px-1.5 select-none h-6.75">
        <div className="flex flex-wrap items-center justify-center gap-0.5 select-none">
          <RepoTreeFilterStat
            id="repo-filter-dirty"
            label="Dirty"
            value={String(summary.dirty)}
            valueClassName={summary.dirty > 0 ? "text-amber-300" : undefined}
            pressed={activeFilter === "dirty"}
            title="Show repositories with uncommitted changes"
            onClick={() => toggleFilter("dirty")}
          />
          <RepoTreeFilterStat
            id="repo-filter-ahead"
            label="Ahead"
            value={String(summary.ahead)}
            valueClassName={summary.ahead > 0 ? "text-emerald-300" : undefined}
            pressed={activeFilter === "ahead"}
            title="Show repositories ahead of their upstream"
            onClick={() => toggleFilter("ahead")}
          />
          <RepoTreeFilterStat
            id="repo-filter-behind"
            label="Behind"
            value={String(summary.behind)}
            valueClassName={summary.behind > 0 ? "text-amber-300" : undefined}
            pressed={activeFilter === "behind"}
            title="Show repositories behind their upstream"
            onClick={() => toggleFilter("behind")}
          />
          <RepoTreeFilterStat
            id="repo-filter-unpublished"
            label="Unpub."
            value={String(summary.unpublished)}
            valueClassName={summary.unpublished > 0 ? "text-violet-300" : undefined}
            pressed={activeFilter === "unpublished"}
            title="Show repositories with no remote. Push creates a private GitHub repo when the GitHub CLI is available."
            onClick={() => toggleFilter("unpublished")}
          />
        </div>
        {activeFilter ? (
          <Button id="clear-filter-button" variant="destructive" size="xs" onClick={handleClearFilter}>
            <span id="clear-filter-label">Clear</span>
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
                  activePath={activePath}
                  collapsed={collapsedView}
                  contextPath={menu?.node.path ?? null}
                  filter={activeFilter}
                  onToggle={(path) => {
                    if (!rootsCollapsible && pathEquals(path, node.path)) {
                      return;
                    }
                    setCollapsed((current) => ({
                      ...current,
                      [path]: !(current[path] ?? defaultCollapsed),
                    }));
                  }}
                  onOpen={onOpen}
                  onViewRepo={onViewRepo}
                  allowRootCollapse={rootsCollapsible}
                  onContextMenu={(next, x, y) => setMenu({ node: next, x, y })}
                  folderVars={folderVars}
                  folderColorMode={colorMode}
                  folderIndicator={treeStyle.folderIndicator}
                  dirtyFolders={dirtyFolders}
                  trailing={
                    <Button
                      id={shownTrees.length === 1 ? "repo-tree-collapse-button" : `repo-tree-collapse-button-${index}`}
                      variant="ghost"
                      title={allCollapsed ? "Expand all" : "Collapse all"}
                      aria-label={allCollapsed ? "Expand all" : "Collapse all"}
                      disabled={trees.length === 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFolders();
                      }}
                      className="h-7 px-1.5 -mr-1.5"
                    >
                      {allCollapsed ? (
                        <ChevronsDown
                          id={shownTrees.length === 1 ? "repo-tree-collapse-icon" : `repo-tree-collapse-icon-${index}`}
                          className="size-4"
                        />
                      ) : (
                        <ChevronsUp
                          id={shownTrees.length === 1 ? "repo-tree-collapse-icon" : `repo-tree-collapse-icon-${index}`}
                          className="size-4"
                        />
                      )}
                    </Button>
                  }
                />
              </div>
            ))}
          </div>
        ) : searchQuery && hasRepos ? (
          <p id="repo-tree-search-empty" className="px-3 py-6 text-sm text-zinc-500">
            No repositories match “{searchQuery}”.
          </p>
        ) : activeFilter && hasRepos ? (
          <p id="repo-tree-filter-empty" className="w-full px-3 py-6 text-sm text-center text-zinc-500">
            {filterEmpty[activeFilter]}
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
                <span id="restore-removed-button-label">Restore hidden items ({removedCount})</span>
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
          menuEditors={menuEditors}
          onOpen={(editor) => {
            const path = menu.node.path;
            setMenu(null);
            onOpenInEditor(path, editor);
          }}
          onOpenGitignore={(editor) => {
            const path = menu.node.path;
            setMenu(null);
            onOpenGitignore(path, editor);
          }}
          onViewRepo={() => {
            const path = menu.node.path;
            setMenu(null);
            onViewRepo(path);
          }}
          onOpenTerminal={() => {
            const path = menu.node.path;
            setMenu(null);
            onOpenInTerminal(path);
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
              id={
                pending.kind === "delete"
                  ? "delete-folder-dialog"
                  : pending.node.kind === "folder"
                    ? "hide-folder-dialog"
                    : "remove-repo-dialog"
              }
              title={
                pending.kind === "delete"
                  ? `Delete ${pending.node.name}`
                  : pending.node.kind === "folder"
                    ? `Hide ${pending.node.name}`
                    : `Remove ${pending.node.name}`
              }
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
              ) : pending.node.kind === "folder" ? (
                <>
                  <p id="hide-folder-copy" className="text-sm text-zinc-300">
                    Hide this folder from the list, including every folder and repository inside it. Nothing is deleted.
                  </p>
                  <p id="hide-folder-restore" className="mt-2 text-sm text-zinc-400">
                    Right-click the tree and choose Restore hidden items to show it again.
                  </p>
                  <p id="hide-folder-path" className="mt-2 break-all font-mono text-xs text-zinc-500">
                    {pending.node.path}
                  </p>
                  <div id="hide-folder-actions" className="mt-4 flex justify-end gap-2">
                    <Button id="hide-folder-cancel" variant="ghost" onClick={() => setPending(null)}>
                      <span id="hide-folder-cancel-label">Cancel</span>
                    </Button>
                    <Button
                      id="hide-folder-confirm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        const path = pending.node.path;
                        setPending(null);
                        onRemoveRepo(path);
                      }}
                    >
                      <span id="hide-folder-confirm-label">Hide folder</span>
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
                    Right-click the tree and choose Restore hidden items to show it again.
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
