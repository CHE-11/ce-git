import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FileChange } from "../../../types/git";
import { cn } from "../lib/cn";
import { domId } from "../lib/tree";

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
  files: FileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
};

export function ChangedFiles({ files, selectedPath, onSelect }: ChangedFilesProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const moved = useRef(false);
  widthRef.current = width;

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
    >
      <h3 id="changed-files-title" className="px-3 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Changes
      </h3>
      {files.length === 0 ? (
        <p id="changed-files-empty" className="px-3 text-sm text-zinc-500">
          Working tree clean
        </p>
      ) : (
        <ul id="changed-files" className="min-h-0 flex-1 overflow-auto">
          {files.map((file) => {
            const selected = file.path === selectedPath;
            const key = `${file.status}-${file.path}`;
            return (
              <li id={domId("changed-file-item", key)} key={`${file.status}-${file.staged}-${file.path}`}>
                <button
                  id={domId("changed-file", key)}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(file.path)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800/80",
                    selected && "bg-sky-950/70",
                  )}
                >
                  <span
                    id={domId("changed-file-status", key)}
                    className="w-16 shrink-0 text-xs text-amber-300"
                  >
                    {file.status}
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
    </section>
  );
}
