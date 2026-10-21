import { AppWindow, Copy, FolderSearch, Terminal, Text } from "lucide-react";
import type { DirEntry } from "../../../../types/git";
import { fileManagerLabel } from "../../lib/changes";
import { editorTargetTitle, editorsForMenu, openInLabel, type EditorId } from "../../lib/editors";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ContextMenu";
import { EditorIcon } from "../EditorIcon";

type FileExplorerContextMenuProps = {
  entry: DirEntry;
  path: string;
  x: number;
  y: number;
  menuEditors: readonly string[];
  onOpenEditor: (editor: EditorId) => void;
  onOpenTerminal: () => void;
  onReveal: () => void;
  onOpenProgram: () => void;
  onClose: () => void;
};

export function FileExplorerContextMenu({
  entry,
  path,
  x,
  y,
  menuEditors,
  onOpenEditor,
  onOpenTerminal,
  onReveal,
  onOpenProgram,
  onClose,
}: FileExplorerContextMenuProps) {
  const folder = entry.kind === "folder";
  const editors = editorsForMenu(menuEditors);
  const target = folder ? "folder" : "file";

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    onClose();
  };

  return (
    <ContextMenu
      id="file-explorer-menu"
      label={`Actions for ${entry.name}`}
      x={x}
      y={y}
      scrollParentId="file-explorer-scroll"
      onClose={onClose}
    >
      {editors.map((editor) => (
        <ContextMenuItem
          id={`file-explorer-menu-open-${editor.id}`}
          key={editor.id}
          icon={<EditorIcon id={`file-explorer-menu-open-${editor.id}-glyph`} editor={editor.id} />}
          label={openInLabel(editor)}
          title={editorTargetTitle(editor, target)}
          onClick={() => onOpenEditor(editor.id)}
        />
      ))}

      {editors.length > 0 ? <ContextMenuSeparator id="file-explorer-menu-separator-system" /> : null}

      <ContextMenuItem
        id="file-explorer-menu-terminal"
        icon={<Terminal id="file-explorer-menu-terminal-glyph" aria-hidden="true" />}
        label="Open in terminal"
        title={folder ? "Open this folder in a terminal" : "Open this file's folder in a terminal"}
        onClick={onOpenTerminal}
      />
      <ContextMenuItem
        id="file-explorer-menu-reveal"
        icon={<FolderSearch id="file-explorer-menu-reveal-glyph" aria-hidden="true" />}
        label={fileManagerLabel()}
        title={folder ? "Open this folder in the native file explorer" : "Show this file in the native file explorer"}
        onClick={onReveal}
      />

      <ContextMenuSeparator id="file-explorer-menu-separator-copy" />

      <ContextMenuItem
        id="file-explorer-menu-copy-name"
        icon={<Text id="file-explorer-menu-copy-name-glyph" aria-hidden="true" />}
        label="Copy name"
        title={entry.name}
        onClick={() => copy(entry.name)}
      />
      <ContextMenuItem
        id="file-explorer-menu-copy-path"
        icon={<Copy id="file-explorer-menu-copy-path-glyph" aria-hidden="true" />}
        label="Copy path"
        title={path}
        onClick={() => copy(path)}
      />

      {folder ? null : (
        <>
          <ContextMenuSeparator id="file-explorer-menu-separator-program" />
          <ContextMenuItem
            id="file-explorer-menu-program"
            icon={<AppWindow id="file-explorer-menu-program-glyph" aria-hidden="true" />}
            label="Open with default program"
            title="Open this file with its default program"
            onClick={onOpenProgram}
          />
        </>
      )}
    </ContextMenu>
  );
}
