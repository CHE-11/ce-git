import Fuse from "fuse.js";
import { Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FileChange } from "../../../../../types/git";
import { cn } from "../../../lib/cn";
import { fileOpenMode, type EditorId } from "../../../lib/editors";
import { statusMark } from "../../../lib/file-status";
import type { ChangeOpenMode, IgnoreKind } from "../../../lib/git-client";
import { domId, messageOf } from "../../../lib/tree";
import { Button } from "../../Button";
import { ActionConfirmDialog } from "../../Dialogs/ActionConfirmDialog";
import { ChangedFileContextMenu } from "./ChangedFileContextMenu";

export type ChangeFileHandlers = {
  discard: (file: FileChange) => void;
  ignore: (kind: IgnoreKind, target: string) => void;
  reveal: (relativePath: string) => void;
  open: (relativePath: string, mode: ChangeOpenMode) => void;
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
  onSelect: (path: string) => void;
};

type FileMenu = {
  file: FileChange;
  x: number;
  y: number;
};

function discardCopy(file: FileChange) {
  if (file.status === "untracked" || file.status === "added") {
    return `Discard ${file.path}? The file will be deleted from disk.`;
  }
  return `Discard ${file.path}? Your changes will be replaced with the last committed version.`;
}

function fileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

export function ChangedFiles({ repoPath, files, selectedPath, busy, handlers, menuEditors, onSelect }: ChangedFilesProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<FileMenu | null>(null);
  const [discarding, setDiscarding] = useState<FileChange | null>(null);
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
  }, [repoPath]);

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
      <h3 id="changed-files-title" className="px-3 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Changes
      </h3>
      {files.length === 0 ? (
        <p id="changed-files-empty" className="px-3 text-sm text-zinc-500">
          Working tree clean
        </p>
      ) : visibleFiles.length === 0 ? (
        <p id="changed-files-search-empty" className="px-3 text-sm text-zinc-500">
          No files match “{searchQuery}”.
        </p>
      ) : (
        <ul id="changed-files" className="min-h-0 flex-1 overflow-auto">
          {visibleFiles.map((file) => {
            const selected = file.path === selectedPath;
            const key = `${file.status}-${file.path}`;
            const mark = statusMark(file.status);
            return (
              <li id={domId("changed-file-item", key)} key={`${file.status}-${file.staged}-${file.path}`}>
                <button
                  id={domId("changed-file", key)}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(file.path)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(file.path);
                    setMenu({ file, x: event.clientX, y: event.clientY });
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800/80",
                    selected && "bg-sky-950/70",
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
                  <span id={domId("changed-file-path", key)} className="truncate text-zinc-200" title={file.path}>
                    {file.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
          repoPath={repoPath}
          x={menu.x}
          y={menu.y}
          busy={busy}
          onDiscard={() => setDiscarding(menu.file)}
          onIgnore={handlers.ignore}
          onReveal={() => handlers.reveal(menu.file.path)}
          menuEditors={menuEditors}
          onOpenInEditor={(editor) => handlers.open(menu.file.path, fileOpenMode(editor))}
          onOpenGitignore={(editor) => handlers.open(".gitignore", fileOpenMode(editor))}
          onOpenProgram={() => handlers.open(menu.file.path, "default")}
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
          const file = discarding;
          setDiscarding(null);
          handlers.discard(file);
        }}
      />
    </section>
  );
}
