import { ExternalLink, FolderMinus, FolderSearch, Trash2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TreeNode } from "../../../types/git";
import type { FolderEditor } from "../lib/git-client";
import { fileManagerLabel } from "../lib/changes";
import { pathEquals } from "../lib/tree";
import { cn } from "../lib/cn";

type TreeContextMenuProps = {
  node: TreeNode;
  x: number;
  y: number;
  rootPaths: string[];
  removedCount: number;
  actionsDisabled: boolean;
  onOpen: (editor: FolderEditor) => void;
  onReveal: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const itemClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-100 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none disabled:opacity-40";

function clampToViewport(x: number, y: number, width: number, height: number) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}

function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
    return;
  }
  const items = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
  if (items.length === 0) {
    return;
  }
  event.preventDefault();
  const list = [...items];
  const index = list.findIndex((item) => item === document.activeElement);
  if (event.key === "Home") {
    list[0]?.focus();
    return;
  }
  if (event.key === "End") {
    list[list.length - 1]?.focus();
    return;
  }
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
  list[next]?.focus();
}

export function TreeContextMenu({
  node,
  x,
  y,
  rootPaths,
  removedCount,
  actionsDisabled,
  onOpen,
  onReveal,
  onRemove,
  onRestore,
  onDelete,
  onClose,
}: TreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState(() => clampToViewport(x, y, 240, 248));
  const isRepo = node.kind === "repo";
  const isRoot = rootPaths.some((root) => pathEquals(node.path, root));

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    setPoint(clampToViewport(x, y, rect.width, rect.height));
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const scroller = document.getElementById("repo-tree-scroll");
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onClose);
    scroller?.addEventListener("scroll", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onClose);
      scroller?.removeEventListener("scroll", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      id="tree-context-menu"
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${node.name}`}
      tabIndex={-1}
      className="fixed z-50 min-w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: point.left, top: point.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        moveMenuFocus(event);
      }}
    >
      <button
        id="tree-context-open"
        type="button"
        role="menuitem"
        className={itemClass}
        title="Open this folder in your default code editor"
        onClick={() => onOpen("default")}
      >
        <ExternalLink id="tree-context-open-icon" className="size-4 shrink-0 text-zinc-400" />
        <span id="tree-context-open-label">Open in default editor</span>
      </button>
      <button
        id="tree-context-open-code"
        type="button"
        role="menuitem"
        className={itemClass}
        title="Open this folder in Visual Studio Code"
        onClick={() => onOpen("code")}
      >
        <VsCodeIcon id="tree-context-open-code-icon" />
        <span id="tree-context-open-code-label">Open in VS Code</span>
      </button>
      <button
        id="tree-context-open-cursor"
        type="button"
        role="menuitem"
        className={itemClass}
        title="Open this folder in Cursor"
        onClick={() => onOpen("cursor")}
      >
        <CursorIcon id="tree-context-open-cursor-icon" />
        <span id="tree-context-open-cursor-label">Open in Cursor</span>
      </button>
      <button
        id="tree-context-reveal"
        type="button"
        role="menuitem"
        className={itemClass}
        title="Open this folder in the native file explorer"
        onClick={onReveal}
      >
        <FolderSearch id="tree-context-reveal-icon" className="size-4 shrink-0 text-zinc-400" />
        <span id="tree-context-reveal-label">{fileManagerLabel()}</span>
      </button>
      {isRepo ? (
        <button
          id="tree-context-remove"
          type="button"
          role="menuitem"
          className={itemClass}
          title="Hide this repository. Files stay on disk."
          disabled={actionsDisabled}
          onClick={onRemove}
        >
          <FolderMinus id="tree-context-remove-icon" className="size-4 shrink-0 text-zinc-400" />
          <span id="tree-context-remove-label">Remove repo</span>
        </button>
      ) : null}
      {removedCount > 0 ? (
        <button
          id="tree-context-restore"
          type="button"
          role="menuitem"
          className={itemClass}
          title="Show repositories removed from this folder"
          disabled={actionsDisabled}
          onClick={onRestore}
        >
          <Undo2 id="tree-context-restore-icon" className="size-4 shrink-0 text-zinc-400" />
          <span id="tree-context-restore-label">Restore removed repos ({removedCount})</span>
        </button>
      ) : null}
      <div id="tree-context-separator" role="separator" className="my-1 h-px bg-zinc-800" />
      <button
        id="tree-context-delete"
        type="button"
        role="menuitem"
        className={cn(itemClass, "text-red-300 hover:bg-red-950/70 focus-visible:bg-red-950/70")}
        title={isRoot ? "An open folder cannot be deleted" : "Move this folder to the Recycle Bin"}
        disabled={actionsDisabled || isRoot}
        onClick={onDelete}
      >
        <Trash2 id="tree-context-delete-icon" className="size-4 shrink-0" />
        <span id="tree-context-delete-label">Delete</span>
      </button>
    </div>,
    document.body,
  );
}

function MenuGlyph({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg id={id} viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}

function VsCodeIcon({ id }: { id: string }) {
  return (
    <MenuGlyph id={id}>
      <path id={`${id}-ribbon`} fill="#23a8f2" d="M17.2 2.4 9.7 8.5 5.5 5.6 2.8 6.9v10.2l2.7 1.3 4.2-2.9 7.5 6.1 3.3-1.6V4l-3.3-1.6Zm.1 3.7v11.8l-5.6-4.5 5.6-7.3Z" />
      <path id={`${id}-fold`} fill="#0078d4" d="M2.8 6.9 9.7 12l-6.9 5.1V6.9Z" />
    </MenuGlyph>
  );
}

function CursorIcon({ id }: { id: string }) {
  return (
    <MenuGlyph id={id}>
      <path id={`${id}-mark`} fill="#f4f4f5" d="M5.2 3.2 19.4 12.1 11.8 13.4 9.3 20.8 5.2 3.2Z" />
    </MenuGlyph>
  );
}
