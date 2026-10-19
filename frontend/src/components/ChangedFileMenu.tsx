import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FileChange } from "../../../types/git";
import { absolutePath, fileExtension, fileManagerLabel, parentDirectories } from "../lib/changes";
import { cn } from "../lib/cn";
import type { IgnoreKind } from "../lib/git-client";
import { domId } from "../lib/tree";

type ChangedFileMenuProps = {
  file: FileChange;
  repoPath: string;
  x: number;
  y: number;
  busy: boolean;
  onDiscard: () => void;
  onIgnore: (kind: IgnoreKind, target: string) => void;
  onReveal: () => void;
  onOpenEditor: () => void;
  onOpenDefault: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
};

const itemClass =
  "flex w-full items-center gap-6 whitespace-nowrap px-3 py-1.5 text-left text-sm text-zinc-100 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent";

const menuClass = "min-w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl";

function clampToViewport(x: number, y: number, width: number, height: number) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}

function moveFocus(event: ReactKeyboardEvent<HTMLElement>, items: HTMLButtonElement[]) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
    return;
  }
  if (items.length === 0) {
    return;
  }
  event.preventDefault();
  const index = items.findIndex((item) => item === document.activeElement);
  if (event.key === "Home") {
    items[0]?.focus();
    return;
  }
  if (event.key === "End") {
    items[items.length - 1]?.focus();
    return;
  }
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const next = index < 0 ? 0 : (index + delta + items.length) % items.length;
  items[next]?.focus();
}

function isInside(target: EventTarget | null, id: string) {
  return target instanceof Element && Boolean(target.closest(`#${id}`));
}

export function ChangedFileMenu({
  file,
  repoPath,
  x,
  y,
  busy,
  onDiscard,
  onIgnore,
  onReveal,
  onOpenEditor,
  onOpenDefault,
  onCopy,
  onClose,
}: ChangedFileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState(() => clampToViewport(x, y, 320, 320));
  const [folderOpen, setFolderOpen] = useState(false);
  const [focusFolders, setFocusFolders] = useState(false);
  const [alignRight, setAlignRight] = useState(() => x + 560 > window.innerWidth);
  const [shift, setShift] = useState(0);
  const directories = parentDirectories(file.path);
  const extension = fileExtension(file.path);
  const deleted = file.status === "deleted";
  const ignoreDisabled = deleted || busy;
  const openDisabled = deleted;
  const revealLabel = fileManagerLabel();

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    setPoint(clampToViewport(x, y, rect.width, rect.height));
    menu.querySelector<HTMLButtonElement>('[data-scope="main"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);

  useLayoutEffect(() => {
    if (!folderOpen || !focusFolders) {
      return;
    }
    submenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [folderOpen, focusFolders]);

  useLayoutEffect(() => {
    if (!folderOpen) {
      return;
    }
    const anchor = submenuRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (!alignRight && rect.right > window.innerWidth - 8) {
      setAlignRight(true);
      return;
    }
    const overflow = rect.bottom - (window.innerHeight - 8);
    setShift(overflow > 0 ? -overflow : 0);
  }, [folderOpen, alignRight]);

  useEffect(() => {
    const closeFolders = () => {
      setFolderOpen(false);
      setFocusFolders(false);
      setShift(0);
      document.getElementById("changed-file-menu-ignore-folder")?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (folderOpen) {
        closeFolders();
        return;
      }
      onClose();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const scroller = document.getElementById("changed-files");
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
  }, [folderOpen, onClose]);

  function closeFolders() {
    setFolderOpen(false);
    setFocusFolders(false);
    setShift(0);
    document.getElementById("changed-file-menu-ignore-folder")?.focus();
  }

  function run(action: () => void) {
    action();
    onClose();
  }

  return createPortal(
    <div
      id="changed-file-menu"
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${file.path}`}
      tabIndex={-1}
      className={cn(menuClass, "fixed z-50")}
      style={{ left: point.left, top: point.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" && isInside(event.target, "changed-file-menu-ignore-folder") && !ignoreDisabled) {
          event.preventDefault();
          setFocusFolders(true);
          setFolderOpen(true);
          return;
        }
        if (event.key === "ArrowLeft" && folderOpen && isInside(event.target, "changed-file-menu-folders")) {
          event.preventDefault();
          closeFolders();
          return;
        }
        const inFolder = folderOpen && isInside(event.target, "changed-file-menu-folders");
        const selector = inFolder
          ? "#changed-file-menu-folders [role='menuitem']:not(:disabled)"
          : "#changed-file-menu [data-scope='main']:not(:disabled)";
        moveFocus(event, [...document.querySelectorAll<HTMLButtonElement>(selector)]);
      }}
    >
      <MenuItem id="changed-file-menu-discard" label="Discard changes" disabled={busy} onClick={() => run(onDiscard)} />
      <MenuSeparator id="changed-file-menu-separator-ignore" />
      <MenuItem
        id="changed-file-menu-ignore-file"
        label="Ignore file (add to .gitignore)"
        disabled={ignoreDisabled}
        onClick={() => run(() => onIgnore("file", file.path))}
      />
      {directories.length > 0 ? (
        <div
          id="changed-file-menu-ignore-folder-wrap"
          className="relative"
          onMouseEnter={() => {
            if (!ignoreDisabled) {
              setFocusFolders(false);
              setFolderOpen(true);
            }
          }}
          onMouseLeave={() => {
            setFolderOpen(false);
            setShift(0);
          }}
        >
          <MenuItem
            id="changed-file-menu-ignore-folder"
            label="Ignore folder (add to .gitignore)"
            disabled={ignoreDisabled}
            hasPopup
            expanded={folderOpen}
            onClick={() => {
              if (!ignoreDisabled) {
                setFocusFolders(true);
                setFolderOpen((open) => !open);
              }
            }}
            trailing={
              <ChevronRight
                id="changed-file-menu-ignore-folder-chevron"
                className="size-3.5 shrink-0 text-zinc-500"
                aria-hidden="true"
              />
            }
          />
          {folderOpen && !ignoreDisabled ? (
            <div
              id="changed-file-menu-folders-anchor"
              ref={submenuRef}
              className={cn("absolute z-10", alignRight ? "right-full pr-1" : "left-full pl-1")}
              style={{ top: shift }}
            >
              <div id="changed-file-menu-folders" role="menu" aria-label="Folders to ignore" className={cn(menuClass, "max-h-[70vh] overflow-auto")}>
                {directories.map((directory) => {
                  const id = domId("changed-file-menu-folder", directory);
                  return (
                    <button
                      id={id}
                      key={directory}
                      type="button"
                      role="menuitem"
                      className={itemClass}
                      title={directory}
                      onClick={() => run(() => onIgnore("folder", directory))}
                    >
                      <span id={`${id}-label`} className="max-w-80 truncate">
                        {directory}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {extension ? (
        <MenuItem
          id="changed-file-menu-ignore-extension"
          label={`Ignore all ${extension} files (add to .gitignore)`}
          disabled={ignoreDisabled}
          onClick={() => run(() => onIgnore("extension", extension))}
        />
      ) : null}
      <MenuSeparator id="changed-file-menu-separator-copy" />
      <MenuItem
        id="changed-file-menu-copy-absolute"
        label="Copy file path"
        onClick={() => run(() => onCopy(absolutePath(repoPath, file.path)))}
      />
      <MenuItem id="changed-file-menu-copy-relative" label="Copy relative file path" onClick={() => run(() => onCopy(file.path))} />
      <MenuSeparator id="changed-file-menu-separator-open" />
      <MenuItem id="changed-file-menu-reveal" label={revealLabel} onClick={() => run(onReveal)} />
      <MenuItem id="changed-file-menu-open-editor" label="Open in external editor" disabled={openDisabled} onClick={() => run(onOpenEditor)} />
      <MenuItem id="changed-file-menu-open-default" label="Open with default program" disabled={openDisabled} onClick={() => run(onOpenDefault)} />
    </div>,
    document.body,
  );
}

function MenuSeparator({ id }: { id: string }) {
  return <div id={id} role="separator" className="my-1 h-px bg-zinc-800" />;
}

function MenuItem({
  id,
  label,
  disabled,
  hasPopup,
  expanded,
  onClick,
  trailing,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  hasPopup?: boolean;
  expanded?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="menuitem"
      data-scope="main"
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? Boolean(expanded) : undefined}
      className={cn(itemClass, trailing ? "justify-between" : undefined)}
      disabled={disabled}
      onClick={onClick}
    >
      <span id={`${id}-label`}>{label}</span>
      {trailing ?? null}
    </button>
  );
}
