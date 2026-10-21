import { Copy, EyeOff, FolderMinus, FolderSearch, FolderTree, Terminal, Text, Trash2, Undo2 } from "lucide-react";
import type { TreeNode } from "../../../../types/git";
import { fileManagerLabel } from "../../lib/changes";
import { editorTargetTitle, editorsForMenu, gitignoreLabel, openInLabel, type EditorId } from "../../lib/editors";
import { pathEquals } from "../../lib/tree";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ContextMenu";
import { EditorIcon } from "../EditorIcon";

type TreeContextMenuProps = {
  node: TreeNode;
  x: number;
  y: number;
  rootPaths: string[];
  removedCount: number;
  actionsDisabled: boolean;
  menuEditors: readonly string[];
  onOpen: (editor: EditorId) => void;
  onOpenGitignore: (editor: EditorId) => void;
  onViewRepo: () => void;
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
  menuEditors,
  onOpen,
  onOpenGitignore,
  onViewRepo,
  onOpenTerminal,
  onReveal,
  onRemove,
  onRestore,
  onDelete,
  onClose,
}: TreeContextMenuProps) {
  const isRepo = node.kind === "repo";
  const isRoot = rootPaths.some((root) => pathEquals(node.path, root));
  const canHideFolder = !isRepo && !isRoot;
  const showManage = isRepo || canHideFolder || removedCount > 0;
  const editors = editorsForMenu(menuEditors);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    onClose();
  };

  return (
    <ContextMenu
      id="tree-context-menu"
      label={`Actions for ${node.name}`}
      x={x}
      y={y}
      scrollParentId="repo-tree-scroll"
      onClose={onClose}
    >
      {editors.map((editor) => (
        <ContextMenuItem
          id={`tree-context-open-${editor.id}`}
          key={editor.id}
          icon={<EditorIcon id={`tree-context-open-${editor.id}-glyph`} editor={editor.id} />}
          label={openInLabel(editor)}
          title={editorTargetTitle(editor, "folder")}
          onClick={() => onOpen(editor.id)}
        />
      ))}

      {isRepo && editors.length > 0 ? <ContextMenuSeparator id="tree-context-separator-gitignore" /> : null}
      {isRepo
        ? editors.map((editor) => (
            <ContextMenuItem
              id={`tree-context-gitignore-${editor.id}`}
              key={`gitignore-${editor.id}`}
              icon={<EditorIcon id={`tree-context-gitignore-${editor.id}-glyph`} editor={editor.id} />}
              label={gitignoreLabel(editor)}
              title={editor.id === "default" ? "Open .gitignore in the default editor" : `Open .gitignore in ${editor.label}`}
              onClick={() => onOpenGitignore(editor.id)}
            />
          ))
        : null}

      {editors.length > 0 ? <ContextMenuSeparator id="tree-context-separator-system" /> : null}

      {isRepo ? (
        <ContextMenuItem
          id="tree-context-view-repo"
          icon={<FolderTree id="tree-context-view-repo-glyph" aria-hidden="true" />}
          label="Open"
          title="Browse this repository's files"
          onClick={onViewRepo}
        />
      ) : null}
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

      <ContextMenuSeparator id="tree-context-separator-copy" />

      <ContextMenuItem
        id="tree-context-copy-name"
        icon={<Text id="tree-context-copy-name-glyph" aria-hidden="true" />}
        label="Copy name"
        title={node.name}
        onClick={() => copy(node.name)}
      />
      <ContextMenuItem
        id="tree-context-copy-path"
        icon={<Copy id="tree-context-copy-path-glyph" aria-hidden="true" />}
        label="Copy path"
        title={node.path}
        onClick={() => copy(node.path)}
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
      {canHideFolder ? (
        <ContextMenuItem
          id="tree-context-hide-folder"
          icon={<EyeOff id="tree-context-hide-folder-glyph" aria-hidden="true" />}
          label="Hide folder"
          title="Hide this folder and everything inside it. Files stay on disk."
          disabled={actionsDisabled}
          onClick={onRemove}
        />
      ) : null}
      {removedCount > 0 ? (
        <ContextMenuItem
          id="tree-context-restore"
          icon={<Undo2 id="tree-context-restore-glyph" aria-hidden="true" />}
          label={`Restore hidden items (${removedCount})`}
          title="Choose hidden folders and repositories to show again"
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
