import { ExternalLink, FolderMinus, FolderSearch, Terminal, Trash2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { TreeNode } from "../../../../types/git";
import type { FolderEditor } from "../../lib/git-client";
import { fileManagerLabel } from "../../lib/changes";
import { pathEquals } from "../../lib/tree";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ContextMenu";

type TreeContextMenuProps = {
  node: TreeNode;
  x: number;
  y: number;
  rootPaths: string[];
  removedCount: number;
  actionsDisabled: boolean;
  onOpen: (editor: FolderEditor) => void;
  onOpenTerminal: () => void;
  onReveal: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function TreeContextMenu({
  node,
  x,
  y,
  rootPaths,
  removedCount,
  actionsDisabled,
  onOpen,
  onOpenTerminal,
  onReveal,
  onRemove,
  onRestore,
  onDelete,
  onClose,
}: TreeContextMenuProps) {
  const isRepo = node.kind === "repo";
  const isRoot = rootPaths.some((root) => pathEquals(node.path, root));
  const showManage = isRepo || removedCount > 0;

  return (
    <ContextMenu
      id="tree-context-menu"
      label={`Actions for ${node.name}`}
      x={x}
      y={y}
      scrollParentId="repo-tree-scroll"
      onClose={onClose}
    >
      <ContextMenuItem
        id="tree-context-open"
        icon={<ExternalLink id="tree-context-open-glyph" aria-hidden="true" />}
        label="Open in default editor"
        title="Open this folder in your default code editor"
        onClick={() => onOpen("default")}
      />
      <ContextMenuItem
        id="tree-context-open-code"
        icon={<VsCodeIcon id="tree-context-open-code-glyph" />}
        label="Open in VS Code"
        title="Open this folder in Visual Studio Code"
        onClick={() => onOpen("code")}
      />
      <ContextMenuItem
        id="tree-context-open-cursor"
        icon={<CursorIcon id="tree-context-open-cursor-glyph" />}
        label="Open in Cursor"
        title="Open this folder in Cursor"
        onClick={() => onOpen("cursor")}
      />

      <ContextMenuSeparator id="tree-context-separator-system" />

      {isRepo ? (
        <ContextMenuItem
          id="tree-context-terminal"
          icon={<Terminal id="tree-context-terminal-glyph" aria-hidden="true" />}
          label="Open in terminal"
          title="Open this repository in a terminal"
          onClick={onOpenTerminal}
        />
      ) : null}
      <ContextMenuItem
        id="tree-context-reveal"
        icon={<FolderSearch id="tree-context-reveal-glyph" aria-hidden="true" />}
        label={fileManagerLabel()}
        title="Open this folder in the native file explorer"
        onClick={onReveal}
      />

      {showManage ? <ContextMenuSeparator id="tree-context-separator-manage" /> : null}
      {isRepo ? (
        <ContextMenuItem
          id="tree-context-remove"
          icon={<FolderMinus id="tree-context-remove-glyph" aria-hidden="true" />}
          label="Remove repo"
          title="Hide this repository. Files stay on disk."
          disabled={actionsDisabled}
          onClick={onRemove}
        />
      ) : null}
      {removedCount > 0 ? (
        <ContextMenuItem
          id="tree-context-restore"
          icon={<Undo2 id="tree-context-restore-glyph" aria-hidden="true" />}
          label={`Restore removed repos (${removedCount})`}
          title="Show repositories removed from this folder"
          disabled={actionsDisabled}
          onClick={onRestore}
        />
      ) : null}

      <ContextMenuSeparator id="tree-context-separator-delete" />

      <ContextMenuItem
        id="tree-context-delete"
        icon={<Trash2 id="tree-context-delete-glyph" aria-hidden="true" />}
        label="Delete"
        title={isRoot ? "An open folder cannot be deleted" : "Move this folder to the Recycle Bin"}
        disabled={actionsDisabled || isRoot}
        danger
        onClick={onDelete}
      />
    </ContextMenu>
  );
}

function MenuGlyph({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg id={id} viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden="true">
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
