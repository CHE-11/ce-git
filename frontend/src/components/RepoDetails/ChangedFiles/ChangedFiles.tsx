import Fuse from "fuse.js";
import { ChevronDown, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FileChange, StashEntry, StashFile } from "../../../../../types/git";
import { cn } from "../../../lib/cn";
import { fileOpenMode, type EditorId } from "../../../lib/editors";
import { statusMark } from "../../../lib/file-status";
import type { ChangeOpenMode, IgnoreKind } from "../../../lib/git-client";
import { domId, messageOf } from "../../../lib/tree";
import { Button } from "../../Button";
import { ActionConfirmDialog } from "../../Dialogs/ActionConfirmDialog";
import { StashChangesDialog } from "../../Dialogs/StashChangesDialog";
import { ChangedFileContextMenu } from "./ChangedFileContextMenu";
import { StashList } from "./StashList";

export type ChangeFileHandlers = {
  discard: (files: FileChange[]) => void;
  ignore: (kind: IgnoreKind, target: string) => void;
  ignoreFiles: (paths: string[]) => void;
  reveal: (relativePath: string) => void;
  open: (relativePath: string, mode: ChangeOpenMode) => void;
  stash: (paths: string[], message: string) => void;
  reportError: (message: string) => void;
};

const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 160;
const MAX_WIDTH = 560;
const WIDTH_KEY = "ce-git.changed-files-width";

function panelLimit() {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.45)));
}

function clampWidth(width: number) {
  return Math.min(panelLimit(), Math.max(MIN_WIDTH, Math.round(width)));
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
    // Ignore storage failures.
  }
}

type ChangedFilesProps = {
  repoPath: string;
  files: FileChange[];
  selectedPath: string | null;
  busy: boolean;
  handlers: ChangeFileHandlers;
  menuEditors: readonly EditorId[];
  stashes: StashEntry[];
  selectedStashId: string | null;
  stashFiles: StashFile[];
  stashFilesLoading: boolean;
  selectedStashPath: string | null;
  onSelect: (path: string) => void;
  onShowFile: () => void;
  onSelectStash: (id: string) => void;
  onSelectStashFile: (path: string) => void;
  onRestoreStash: (id: string) => void;
  onApplyStash: (id: string) => void;
  onDropStash: (id: string) => void;
};

type FileMenu = {
  file: FileChange;
  targets: FileChange[];
  x: number;
  y: number;
};

function removesOnDiscard(file: FileChange) {
  return file.status === "untracked" || file.status === "added";
}

function discardCopy(files: FileChange[]) {
  const file = files[0];
  if (!file) {
    return "";
  }
  if (files.length === 1) {
    if (removesOnDiscard(file)) {
      return `Discard ${file.path}? The file will be deleted from disk.`;
    }
    return `Discard ${file.path}? Your changes will be replaced with the last committed version.`;
  }
  const removes = files.filter(removesOnDiscard).length;
  if (removes === files.length) {
    return `Discard ${files.length} files? They will be deleted from disk.`;
  }
  if (removes === 0) {
    return `Discard ${files.length} files? Your changes will be replaced with the last committed version.`;
  }
  const noun = removes === 1 ? "file is" : "files are";
  return `Discard ${files.length} files? Committed files are restored, and ${removes} untracked ${noun} deleted from disk.`;
}

function stashPathList(files: FileChange[]) {
  const paths: string[] = [];
  for (const file of files) {
    if (!paths.includes(file.path)) {
      paths.push(file.path);
    }
    if (file.previousPath && !paths.includes(file.previousPath)) {
      paths.push(file.previousPath);
    }
  }
  return paths;
}

function fileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

export function ChangedFiles({
  repoPath,
  files,
  selectedPath,
  busy,
  handlers,
  menuEditors,
  stashes,
  selectedStashId,
  stashFiles,
  stashFilesLoading,
  selectedStashPath,
  onSelect,
  onShowFile,
  onSelectStash,
  onSelectStashFile,
  onRestoreStash,
  onApplyStash,
  onDropStash,
}: ChangedFilesProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<FileMenu | null>(null);
  const [discarding, setDiscarding] = useState<FileChange[] | null>(null);
  const [stashing, setStashing] = useState<FileChange[] | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [changesOpen, setChangesOpen] = useState(true);
  const [stashesOpen, setStashesOpen] = useState(true);
  const anchorRef = useRef<string | null>(null);
  const selectedPathsRef = useRef(selectedPaths);
  selectedPathsRef.current = selectedPaths;
  const [query, setQuery] = useState("");
  const searchQuery = query.trim();
  const visibleFiles = useMemo(() => {
    if (!searchQuery) {
      return files;
    }
    const fuse = new Fuse(
      files.map((file) => ({
        file,
        name: fileName(file.path),
        path: file.path,
        previousPath: file.previousPath ?? "",
        status: file.status,
      })),
      {
        keys: [
          { name: "name", weight: 0.6 },
          { name: "path", weight: 0.25 },
          { name: "previousPath", weight: 0.1 },
          { name: "status", weight: 0.05 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      },
    );
    return fuse.search(searchQuery).map((result) => result.item.file);
  }, [files, searchQuery]);
  const widthRef = useRef(width);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const moved = useRef(false);
  widthRef.current = width;

  useEffect(() => {
    setQuery("");
    setSelectedPaths([]);
    anchorRef.current = null;
  }, [repoPath]);

  useEffect(() => {
    setSelectedPaths((current) => {
      const next = current.filter((path) => files.some((file) => file.path === path));
      return next.length === current.length ? current : next;
    });
  }, [files]);

  useEffect(() => {
    function clearFileSelection() {
      if (selectedPathsRef.current.length === 0) {
        return false;
      }
      anchorRef.current = null;
      setSelectedPaths([]);
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("[data-changed-file]")) {
        active.blur();
      }
      return true;
    }

    function keepsSelection(target: EventTarget | null) {
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      if (!element) {
        return false;
      }
      return Boolean(
        element.closest(
          "[data-changed-file], #changed-file-menu, #discard-change-dialog-backdrop, #stash-changes-dialog-backdrop",
        ),
      );
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || keepsSelection(event.target)) {
        return;
      }
      clearFileSelection();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) {
        return;
      }
      if (document.querySelector("[role='dialog'], [role='menu']")) {
        return;
      }
      if (clearFileSelection()) {
        event.preventDefault();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      setWidth((current) => clampWidth(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!menu) {
      return;
    }
    if (!files.some((file) => file.path === menu.file.path && file.status === menu.file.status)) {
      setMenu(null);
    }
  }, [files, menu]);

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

  function chooseFiles(file: FileChange, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    const path = file.path;
    const order = visibleFiles.map((item) => item.path);
    let next: string[];
    if (event.shiftKey && anchorRef.current) {
      const start = order.indexOf(anchorRef.current);
      const end = order.indexOf(path);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        next = order.slice(from, to + 1);
      } else {
        anchorRef.current = path;
        next = [path];
      }
    } else if (event.metaKey || event.ctrlKey) {
      anchorRef.current = path;
      next = selectedPaths.includes(path) ? selectedPaths.filter((item) => item !== path) : [...selectedPaths, path];
    } else {
      anchorRef.current = path;
      next = [path];
    }
    setSelectedPaths(next);
    onShowFile();
    if (next.includes(path)) {
      onSelect(path);
    } else if (next.length > 0) {
      onSelect(next[next.length - 1]);
    }
  }

  function openMenu(file: FileChange, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const keep = selectedPaths.includes(file.path);
    const next = keep ? selectedPaths : [file.path];
    if (!keep) {
      anchorRef.current = file.path;
      setSelectedPaths(next);
    }
    onSelect(file.path);
    onShowFile();
    const chosen = new Set(next);
    const targets = files.filter((item) => chosen.has(item.path));
    setMenu({
      file,
      targets: targets.length > 0 ? targets : [file],
      x: event.clientX,
      y: event.clientY,
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
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
      commitWidth(panelLimit());
    }
  }

  return (
    <section
      id="changed-files-panel"
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-zinc-800"
      onContextMenu={(event) => event.preventDefault()}
    >
      <form
        id="changed-files-search"
        className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Search id="changed-files-search-icon" className="size-3.5 shrink-0 text-zinc-500" />
        <input
          id="changed-files-search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search changes"
          aria-label="Search changes"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        {query ? (
          <Button
            id="changed-files-search-clear"
            variant="ghost"
            size="xs"
            className="h-6 px-1"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X id="changed-files-search-clear-icon" className="size-3.5" />
          </Button>
        ) : null}
      </form>
      <button
        id="changed-files-toggle"
        type="button"
        aria-expanded={changesOpen}
        aria-controls="changed-files"
        onClick={() => setChangesOpen((open) => !open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
      >
        <ChevronDown
          id="changed-files-toggle-chevron"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 transition-transform", !changesOpen && "-rotate-90")}
        />
        <span id="changed-files-title">Changes</span>
        <span id="changed-files-count" className="text-zinc-600">
          {files.length}
        </span>
      </button>
      <div id="changed-files-body" className="flex min-h-0 flex-1 flex-col">
      {changesOpen && files.length === 0 ? (
        <p id="changed-files-empty" className="px-3 text-sm text-zinc-500">
          Working tree clean
        </p>
      ) : changesOpen && visibleFiles.length === 0 ? (
        <p id="changed-files-search-empty" className="px-3 text-sm text-zinc-500">
          No files match “{searchQuery}”.
        </p>
      ) : changesOpen ? (
        <ul id="changed-files" className="min-h-0 flex-1 overflow-auto select-none">
          {visibleFiles.map((file) => {
            const selected = selectedPaths.includes(file.path);
            const current = file.path === selectedPath;
            const key = `${file.status}-${file.path}`;
            const mark = statusMark(file.status);
            return (
              <li id={domId("changed-file-item", key)} key={`${file.status}-${file.staged}-${file.path}`}>
                <button
                  id={domId("changed-file", key)}
                  type="button"
                  data-changed-file=""
                  aria-selected={selected}
                  aria-current={current ? "true" : undefined}
                  onMouseDown={(event) => {
                    if (event.shiftKey) {
                      event.preventDefault();
                    }
                  }}
                  onClick={(event) => chooseFiles(file, event)}
                  onContextMenu={(event) => openMenu(file, event)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800/80 focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-sky-400",
                    selected && "row-selected",
                  )}
                >
                  <span
                    id={domId("changed-file-status", key)}
                    title={mark.label}
                    aria-label={mark.label}
                    className={cn(
                      "w-4 shrink-0 text-center text-xs font-semibold",
                      mark.className,
                    )}
                  >
                    {mark.letter}
                  </span>
                  <span
                    id={domId("changed-file-path", key)}
                    className={cn("truncate", selected ? "text-zinc-50" : "text-zinc-200")}
                    title={file.path}
                  >
                    {file.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {stashes.length > 0 ? (
        <StashList
          stashes={stashes}
          selectedId={selectedStashId}
          files={stashFiles}
          filesLoading={stashFilesLoading}
          selectedPath={selectedStashPath}
          busy={busy}
          onSelect={onSelectStash}
          onSelectFile={onSelectStashFile}
          open={stashesOpen}
          fill={!changesOpen}
          onToggle={() => setStashesOpen((open) => !open)}
          onRestore={onRestoreStash}
          onApply={onApplyStash}
          onDrop={onDropStash}
        />
      ) : null}
      </div>
      <div
        id="changed-files-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize changes panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={panelLimit()}
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
          id="changed-files-resizer-line"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-500 opacity-0 transition-opacity",
            dragging && "opacity-100",
            "group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        />
      </div>
      {menu ? (
        <ChangedFileContextMenu
          key={`${menu.file.status}-${menu.file.path}-${menu.x}-${menu.y}`}
          file={menu.file}
          targets={menu.targets}
          repoPath={repoPath}
          x={menu.x}
          y={menu.y}
          busy={busy}
          onDiscard={() => setDiscarding(menu.targets)}
          onStash={() => setStashing(menu.targets)}
          onIgnore={handlers.ignore}
          onIgnoreFiles={() => {
            handlers.ignoreFiles(menu.targets.filter((item) => item.status !== "deleted").map((item) => item.path));
          }}
          onReveal={() => handlers.reveal(menu.file.path)}
          menuEditors={menuEditors}
          onOpenInEditor={(editor) => {
            for (const target of menu.targets) {
              if (target.status === "deleted") {
                continue;
              }
              handlers.open(target.path, fileOpenMode(editor));
            }
          }}
          onOpenGitignore={(editor) => handlers.open(".gitignore", fileOpenMode(editor))}
          onOpenProgram={() => {
            for (const target of menu.targets) {
              if (target.status === "deleted") {
                continue;
              }
              handlers.open(target.path, "default");
            }
          }}
          onCopy={(text) => {
            void navigator.clipboard.writeText(text).catch((caught) => {
              handlers.reportError(messageOf(caught));
            });
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <ActionConfirmDialog
        id="discard-change-dialog"
        title="Discard changes"
        copy={discarding ? discardCopy(discarding) : ""}
        confirmLabel="Discard"
        confirmTone="destructive"
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        onConfirm={() => {
          if (!discarding) {
            return;
          }
          const filesToDiscard = discarding;
          setDiscarding(null);
          handlers.discard(filesToDiscard);
        }}
      />
      <StashChangesDialog
        key={stashing ? stashing.map((file) => `${file.status}:${file.path}`).join("|") : "stash-changes"}
        files={stashing ?? []}
        open={stashing !== null}
        onClose={() => setStashing(null)}
        onConfirm={(message) => {
          if (!stashing) {
            return;
          }
          const paths = stashPathList(stashing);
          setStashing(null);
          handlers.stash(paths, message);
        }}
      />
    </section>
  );
}
