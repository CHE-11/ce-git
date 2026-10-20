import { AppWindow, ChevronRight, Copy, FileX, Files, Folder, FolderSearch, FolderX, Link2, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FileChange } from "../../../types/git";
import { absolutePath, fileExtension, fileManagerLabel, parentDirectories } from "../lib/changes";
import { cn } from "../lib/cn";
import { editorTargetTitle, editorsForMenu, gitignoreLabel, openInLabel, type EditorId } from "../lib/editors";
import type { IgnoreKind } from "../lib/git-client";
import { domId } from "../lib/tree";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, contextMenuPanelClass } from "./ContextMenu";
import { EditorIcon } from "./EditorIcon";

type ChangedFileMenuProps = {
  file: FileChange;
  repoPath: string;
  x: number;
  y: number;
  busy: boolean;
  onDiscard: () => void;
  onIgnore: (kind: IgnoreKind, target: string) => void;
  onReveal: () => void;
  menuEditors: readonly string[];
  onOpenInEditor: (editor: EditorId) => void;
  onOpenGitignore: (editor: EditorId) => void;
  onOpenProgram: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
};

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

export function ChangedFileContextMenu({
  file,
  repoPath,
  x,
  y,
  busy,
  onDiscard,
  onIgnore,
  onReveal,
  menuEditors,
  onOpenInEditor,
  onOpenGitignore,
  onOpenProgram,
  onCopy,
  onClose,
}: ChangedFileMenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
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
  const editors = editorsForMenu(menuEditors);

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

  return (
    <ContextMenu
      id="changed-file-menu"
      label={`Actions for ${file.path}`}
      x={x}
      y={y}
      scrollParentId="changed-files"
      onClose={onClose}
      onEscape={() => {
        if (!folderOpen) {
          return false;
        }
        closeFolders();
        return true;
      }}
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
      <ContextMenuItem
        id="changed-file-menu-discard"
        scope="main"
        icon={<Undo2 id="changed-file-menu-discard-glyph" aria-hidden="true" />}
        label="Discard changes"
        disabled={busy}
        onClick={() => run(onDiscard)}
      />

      <ContextMenuSeparator id="changed-file-menu-separator-ignore" />

      <ContextMenuItem
        id="changed-file-menu-ignore-file"
        scope="main"
        icon={<FileX id="changed-file-menu-ignore-file-glyph" aria-hidden="true" />}
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
          <ContextMenuItem
            id="changed-file-menu-ignore-folder"
            scope="main"
            icon={<FolderX id="changed-file-menu-ignore-folder-glyph" aria-hidden="true" />}
            label="Ignore folder (add to .gitignore)"
            disabled={ignoreDisabled}
            hasPopup
            expanded={folderOpen}
            onClick={() => {
              if (ignoreDisabled) {
                return;
              }
              setFocusFolders(true);
              setFolderOpen(true);
            }}
            trailing={
              <ChevronRight
                id="changed-file-menu-ignore-folder-chevron"
                className="size-3 shrink-0 text-zinc-500"
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
              <div
                id="changed-file-menu-folders"
                role="menu"
                aria-label="Folders to ignore"
                className={cn(contextMenuPanelClass, "max-h-[70vh] overflow-auto")}
              >
                {directories.map((directory) => {
                  const id = domId("changed-file-menu-folder", directory);
                  return (
                    <ContextMenuItem
                      id={id}
                      key={directory}
                      icon={<Folder id={`${id}-glyph`} aria-hidden="true" />}
                      label={directory}
                      title={directory}
                      labelClassName="max-w-80"
                      onClick={() => run(() => onIgnore("folder", directory))}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {extension ? (
        <ContextMenuItem
          id="changed-file-menu-ignore-extension"
          scope="main"
          icon={<Files id="changed-file-menu-ignore-extension-glyph" aria-hidden="true" />}
          label={`Ignore all ${extension} files (add to .gitignore)`}
          disabled={ignoreDisabled}
          onClick={() => run(() => onIgnore("extension", extension))}
        />
      ) : null}

      <ContextMenuSeparator id="changed-file-menu-separator-copy" />

      <ContextMenuItem
        id="changed-file-menu-copy-absolute"
        scope="main"
        icon={<Copy id="changed-file-menu-copy-absolute-glyph" aria-hidden="true" />}
        label="Copy file path"
        onClick={() => run(() => onCopy(absolutePath(repoPath, file.path)))}
      />
      <ContextMenuItem
        id="changed-file-menu-copy-relative"
        scope="main"
        icon={<Link2 id="changed-file-menu-copy-relative-glyph" aria-hidden="true" />}
        label="Copy relative file path"
        onClick={() => run(() => onCopy(file.path))}
      />

      <ContextMenuSeparator id="changed-file-menu-separator-reveal" />

      <ContextMenuItem
        id="changed-file-menu-reveal"
        scope="main"
        icon={<FolderSearch id="changed-file-menu-reveal-glyph" aria-hidden="true" />}
        label={revealLabel}
        onClick={() => run(onReveal)}
      />

      {editors.length > 0 ? <ContextMenuSeparator id="changed-file-menu-separator-open" /> : null}
      {editors.map((editor) => (
        <ContextMenuItem
          id={`changed-file-menu-open-${editor.id}`}
          key={`open-${editor.id}`}
          scope="main"
          icon={<EditorIcon id={`changed-file-menu-open-${editor.id}-glyph`} editor={editor.id} />}
          label={openInLabel(editor)}
          title={editorTargetTitle(editor, "file")}
          disabled={openDisabled}
          onClick={() => run(() => onOpenInEditor(editor.id))}
        />
      ))}

      {editors.length > 0 ? <ContextMenuSeparator id="changed-file-menu-separator-gitignore" /> : null}
      {editors.map((editor) => (
        <ContextMenuItem
          id={`changed-file-menu-gitignore-${editor.id}`}
          key={`gitignore-${editor.id}`}
          scope="main"
          icon={<EditorIcon id={`changed-file-menu-gitignore-${editor.id}-glyph`} editor={editor.id} />}
          label={gitignoreLabel(editor)}
          title={editor.id === "default" ? "Open .gitignore in the default editor" : `Open .gitignore in ${editor.label}`}
          onClick={() => run(() => onOpenGitignore(editor.id))}
        />
      ))}

      <ContextMenuSeparator id="changed-file-menu-separator-default" />

      <ContextMenuItem
        id="changed-file-menu-open-default"
        scope="main"
        icon={<AppWindow id="changed-file-menu-open-default-glyph" aria-hidden="true" />}
        label="Open with default program"
        disabled={openDisabled}
        onClick={() => run(onOpenProgram)}
      />
    </ContextMenu>
  );
}
