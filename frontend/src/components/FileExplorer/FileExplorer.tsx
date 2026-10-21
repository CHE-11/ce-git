import { ArrowLeft, ChevronDown, ChevronRight, File, Folder, FolderOpen, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { DirEntry } from "../../../../types/git";
import { absolutePath, parentDirectories } from "../../lib/changes";
import { cn } from "../../lib/cn";
import { fileOpenMode, type EditorId } from "../../lib/editors";
import { listDirectory, searchDirectory, type ChangeOpenMode } from "../../lib/git-client";
import { baseName, domId, messageOf } from "../../lib/tree";
import { Button } from "../Button";
import { FileExplorerContextMenu } from "./FileExplorerContextMenu";

type FileExplorerProps = {
  repoPath: string;
  menuEditors: readonly EditorId[];
  defaultEditor: EditorId;
  onClose: () => void;
  onOpenInEditor: (path: string, editor: EditorId) => void;
  onOpenInTerminal: (path: string) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile: (relativePath: string, mode: ChangeOpenMode) => void;
};

type MenuState = {
  entry: DirEntry;
  x: number;
  y: number;
};

type EntryHandlers = {
  selectedPath: string | null;
  menuPath: string | null;
  loadingPath: string | null;
  onSelect: (entry: DirEntry) => void;
  onActivate: (entry: DirEntry) => void;
  onToggle: (entry: DirEntry) => void;
  onMenu: (entry: DirEntry, x: number, y: number) => void;
};

export function FileExplorer({
  repoPath,
  menuEditors,
  defaultEditor,
  onClose,
  onOpenInEditor,
  onOpenInTerminal,
  onRevealInExplorer,
  onOpenFile,
}: FileExplorerProps) {
  const [entries, setEntries] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [rootLoading, setRootLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchEntries, setSearchEntries] = useState<DirEntry[] | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const repoRef = useRef(repoPath);
  repoRef.current = repoPath;
  const browsing = query.trim().length === 0;
  const name = baseName(repoPath);

  useEffect(() => {
    let cancelled = false;
    setRootLoading(true);
    setListError(null);
    setEntries({});
    setExpanded({});
    setSelectedPath(null);
    setMenu(null);
    void listDirectory(repoPath, "")
      .then((rows) => {
        if (!cancelled) {
          setEntries({ "": rows });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setListError(messageOf(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRootLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearching(false);
      setSearchEntries(null);
      setSearchTruncated(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchDirectory(repoPath, trimmed)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setSearchEntries(result.entries);
          setSearchTruncated(result.truncated);
          setSearchError(null);
        })
        .catch((caught) => {
          if (cancelled) {
            return;
          }
          setSearchEntries(null);
          setSearchTruncated(false);
          setSearchError(messageOf(caught));
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, repoPath]);

  async function toggleFolder(entry: DirEntry) {
    if (entry.kind !== "folder") {
      return;
    }
    if (expanded[entry.relativePath]) {
      setExpanded((current) => ({ ...current, [entry.relativePath]: false }));
      return;
    }
    setExpanded((current) => ({ ...current, [entry.relativePath]: true }));
    if (entries[entry.relativePath]) {
      return;
    }
    const repo = repoPath;
    setLoadingPath(entry.relativePath);
    setListError(null);
    try {
      const rows = await listDirectory(repo, entry.relativePath);
      if (repoRef.current !== repo) {
        return;
      }
      setEntries((current) => ({ ...current, [entry.relativePath]: rows }));
    } catch (caught) {
      if (repoRef.current !== repo) {
        return;
      }
      setExpanded((current) => ({ ...current, [entry.relativePath]: false }));
      setListError(messageOf(caught));
    } finally {
      if (repoRef.current === repo) {
        setLoadingPath((current) => (current === entry.relativePath ? null : current));
      }
    }
  }

  function activate(entry: DirEntry) {
    if (entry.kind === "folder") {
      if (browsing) {
        void toggleFolder(entry);
      } else {
        onOpenInEditor(absolutePath(repoPath, entry.relativePath), defaultEditor);
      }
      return;
    }
    onOpenFile(entry.relativePath, fileOpenMode(defaultEditor));
  }

  function openMenu(entry: DirEntry, x: number, y: number) {
    setSelectedPath(entry.relativePath);
    setMenu({ entry, x, y });
  }

  const handlers: EntryHandlers = {
    selectedPath,
    menuPath: menu?.entry.relativePath ?? null,
    loadingPath,
    onSelect: (entry) => setSelectedPath(entry.relativePath),
    onActivate: activate,
    onToggle: (entry) => void toggleFolder(entry),
    onMenu: openMenu,
  };

  const menuEntry = menu?.entry ?? null;

  return (
    <section id="file-explorer" className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      <header id="file-explorer-header" className="border-b border-zinc-800 px-4 py-3">
        <div id="file-explorer-title-row" className="flex items-center justify-between gap-3">
          <h2 id="file-explorer-name" className="min-w-0 truncate text-lg font-semibold text-zinc-100">
            {name}
          </h2>
          <Button id="file-explorer-back" variant="secondary" size="sm" onClick={onClose} title="Back to changes">
            <ArrowLeft id="file-explorer-back-icon" className="size-3.5" aria-hidden="true" />
            <span id="file-explorer-back-label">Changes</span>
          </Button>
        </div>
        <p id="file-explorer-path" className="truncate text-xs text-zinc-500" title={repoPath}>
          {repoPath}
        </p>
      </header>
      <form
        id="file-explorer-search"
        className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5"
        onSubmit={(event) => event.preventDefault()}
      >
        {searching ? (
          <Loader2 id="file-explorer-search-spinner" className="size-3.5 shrink-0 animate-spin text-zinc-500" aria-hidden="true" />
        ) : (
          <Search id="file-explorer-search-icon" className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
        )}
        <input
          id="file-explorer-search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files and folders"
          aria-label="Search files and folders"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </form>
      <div
        id="file-explorer-scroll"
        role={browsing ? "tree" : "list"}
        aria-label={browsing ? "Repository files" : "Search results"}
        aria-busy={rootLoading || searching}
        className="min-h-0 flex-1 overflow-auto py-1 pr-2 pl-1"
      >
        {browsing && listError ? (
          <p id="file-explorer-error" className="px-3 py-2 text-sm text-red-400">
            {listError}
          </p>
        ) : null}
        {browsing && rootLoading ? (
          <p id="file-explorer-loading" className="px-3 py-6 text-sm text-zinc-500">
            Loading files…
          </p>
        ) : null}
        {browsing && !rootLoading && !listError && entries[""]?.length === 0 ? (
          <p id="file-explorer-empty" className="px-3 py-6 text-sm text-zinc-500">
            This folder is empty.
          </p>
        ) : null}
        {browsing && !rootLoading ? <ExplorerBranch parent="" depth={0} entries={entries} expanded={expanded} {...handlers} /> : null}
        {!browsing && searchError ? (
          <p id="file-explorer-search-error" className="px-3 py-2 text-sm text-red-400">
            {searchError}
          </p>
        ) : null}
        {!browsing && searching && !searchEntries ? (
          <p id="file-explorer-searching" className="px-3 py-6 text-sm text-zinc-500">
            Searching…
          </p>
        ) : null}
        {!browsing && searchEntries && searchEntries.length === 0 && !searching ? (
          <p id="file-explorer-search-empty" className="px-3 py-6 text-sm text-zinc-500">
            No files or folders match.
          </p>
        ) : null}
        {!browsing && searchEntries
          ? searchEntries.map((entry) => (
              <ExplorerEntry
                key={entry.relativePath}
                entry={entry}
                depth={0}
                expanded={false}
                showChildren={false}
                subtitle={entry.relativePath.includes("/") ? entry.relativePath : undefined}
                {...handlers}
              />
            ))
          : null}
        {!browsing && searchTruncated ? (
          <p id="file-explorer-truncated" className="px-3 py-2 text-xs text-zinc-500">
            Results are incomplete. Refine the search to see more.
          </p>
        ) : null}
      </div>
      {menu && menuEntry ? (
        <FileExplorerContextMenu
          entry={menuEntry}
          path={absolutePath(repoPath, menuEntry.relativePath)}
          x={menu.x}
          y={menu.y}
          menuEditors={menuEditors}
          onOpenEditor={(editor) => {
            const entry = menuEntry;
            setMenu(null);
            if (entry.kind === "folder") {
              onOpenInEditor(absolutePath(repoPath, entry.relativePath), editor);
              return;
            }
            onOpenFile(entry.relativePath, fileOpenMode(editor));
          }}
          onOpenTerminal={() => {
            const entry = menuEntry;
            setMenu(null);
            onOpenInTerminal(terminalDirectory(repoPath, entry));
          }}
          onReveal={() => {
            const entry = menuEntry;
            setMenu(null);
            onRevealInExplorer(absolutePath(repoPath, entry.relativePath));
          }}
          onOpenProgram={() => {
            const entry = menuEntry;
            setMenu(null);
            onOpenFile(entry.relativePath, "default");
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}

function terminalDirectory(repoPath: string, entry: DirEntry) {
  if (entry.kind === "folder") {
    return absolutePath(repoPath, entry.relativePath);
  }
  const parent = parentDirectories(entry.relativePath)[0];
  return parent ? absolutePath(repoPath, parent) : repoPath;
}

function ExplorerBranch({
  parent,
  depth,
  entries,
  expanded,
  ...handlers
}: EntryHandlers & {
  parent: string;
  depth: number;
  entries: Record<string, DirEntry[]>;
  expanded: Record<string, boolean>;
}) {
  const children = entries[parent];
  if (!children) {
    return null;
  }
  return children.map((entry) => (
    <ExplorerEntry
      key={entry.relativePath}
      entry={entry}
      depth={depth}
      expanded={Boolean(expanded[entry.relativePath])}
      showChildren
      entries={entries}
      expandedMap={expanded}
      {...handlers}
    />
  ));
}

function ExplorerEntry({
  entry,
  depth,
  expanded,
  showChildren,
  subtitle,
  entries,
  expandedMap,
  selectedPath,
  menuPath,
  loadingPath,
  onSelect,
  onActivate,
  onToggle,
  onMenu,
}: EntryHandlers & {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  showChildren: boolean;
  subtitle?: string;
  entries?: Record<string, DirEntry[]>;
  expandedMap?: Record<string, boolean>;
}) {
  const folder = entry.kind === "folder";
  const rowId = domId("explorer-row", entry.relativePath);
  const selected = entry.relativePath === selectedPath;
  const targeted = entry.relativePath === menuPath;
  const loading = loadingPath === entry.relativePath;
  const children = entries?.[entry.relativePath];
  const paddingLeft = 8 + depth * 14;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    onActivate(entry);
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMenu(entry, event.clientX, event.clientY);
  };

  return (
    <div id={domId("explorer-node", entry.relativePath)}>
      <div
        id={rowId}
        role={showChildren ? "treeitem" : "listitem"}
        aria-expanded={folder && showChildren ? expanded : undefined}
        aria-selected={selected}
        tabIndex={0}
        title={entry.relativePath}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm select-none hover:bg-zinc-800/80 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-sky-700",
          selected && "bg-sky-950/70",
          targeted && "ring-1 ring-inset ring-sky-800",
        )}
        style={{ paddingLeft }}
        onClick={() => onSelect(entry)}
        onDoubleClick={() => onActivate(entry)}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {showChildren && folder ? (
          <button
            id={domId("explorer-toggle", entry.relativePath)}
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-zinc-500"
            aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
            onClick={(event) => {
              event.stopPropagation();
              if (event.detail > 1) {
                return;
              }
              onToggle(entry);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {loading ? (
              <Loader2 id={domId("explorer-spinner", entry.relativePath)} className="size-3.5 animate-spin" aria-hidden="true" />
            ) : expanded ? (
              <ChevronDown id={domId("explorer-chevron", entry.relativePath)} className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight id={domId("explorer-chevron", entry.relativePath)} className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {showChildren && !folder ? (
          <span id={domId("explorer-spacer", entry.relativePath)} className="size-4 shrink-0" />
        ) : null}
        {folder ? (
          expanded && showChildren ? (
            <FolderOpen id={domId("explorer-icon", entry.relativePath)} className="size-3.5 shrink-0 text-sky-300" aria-hidden="true" />
          ) : (
            <Folder id={domId("explorer-icon", entry.relativePath)} className="size-3.5 shrink-0 text-sky-300" aria-hidden="true" />
          )
        ) : (
          <File id={domId("explorer-icon", entry.relativePath)} className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        )}
        <span id={domId("explorer-name", entry.relativePath)} className="truncate text-zinc-100">
          {entry.name}
        </span>
        {subtitle ? (
          <span id={domId("explorer-subtitle", entry.relativePath)} className="truncate text-xs text-zinc-500">
            {subtitle}
          </span>
        ) : null}
      </div>
      {folder && showChildren && expanded ? (
        <div id={domId("explorer-children", entry.relativePath)} role="group">
          {loading && !children ? (
            <p
              id={domId("explorer-loading", entry.relativePath)}
              className="py-1 text-xs text-zinc-500"
              style={{ paddingLeft: paddingLeft + 22 }}
            >
              Loading…
            </p>
          ) : null}
          {children && children.length === 0 ? (
            <p
              id={domId("explorer-empty", entry.relativePath)}
              className="py-1 text-xs text-zinc-500"
              style={{ paddingLeft: paddingLeft + 22 }}
            >
              Empty folder
            </p>
          ) : null}
          {children && children.length > 0 && expandedMap ? (
            <ExplorerBranch
              parent={entry.relativePath}
              depth={depth + 1}
              entries={entries ?? {}}
              expanded={expandedMap}
              selectedPath={selectedPath}
              menuPath={menuPath}
              loadingPath={loadingPath}
              onSelect={onSelect}
              onActivate={onActivate}
              onToggle={onToggle}
              onMenu={onMenu}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
