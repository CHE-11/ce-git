import { Archive, ArchiveRestore, ChevronDown, FolderInput, Trash2 } from "lucide-react";
import { useState } from "react";
import type { StashEntry, StashFile } from "../../../../../types/git";
import { cn } from "../../../lib/cn";
import { statusMark } from "../../../lib/file-status";
import { domId } from "../../../lib/tree";
import { ActionConfirmDialog } from "../../Dialogs/ActionConfirmDialog";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../ContextMenu";

type StashListProps = {
  stashes: StashEntry[];
  selectedId: string | null;
  files: StashFile[];
  filesLoading: boolean;
  selectedPath: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onSelectFile: (path: string) => void;
  open: boolean;
  fill: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
  onApply: (id: string) => void;
  onDrop: (id: string) => void;
};

type StashMenu = {
  stash: StashEntry;
  x: number;
  y: number;
};

type PendingStash = {
  stash: StashEntry;
  action: "restore" | "drop";
};

const PULL_TITLE = "This stash belongs to a pull in progress.";

function stashDate(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StashList({
  stashes,
  selectedId,
  files,
  filesLoading,
  selectedPath,
  busy,
  onSelect,
  onSelectFile,
  open,
  fill,
  onToggle,
  onRestore,
  onApply,
  onDrop,
}: StashListProps) {
  const [menu, setMenu] = useState<StashMenu | null>(null);
  const [pending, setPending] = useState<PendingStash | null>(null);
  const pullLocked = menu?.stash.pull ?? false;

  return (
    <section
      id="stashes"
      className={cn(
        "flex flex-col border-t border-zinc-800",
        open && fill && "min-h-0 flex-1",
        open && !fill && "max-h-[40%] min-h-0 shrink-0",
        !open && "mt-auto shrink-0",
      )}
    >
      <button
        id="stashes-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="stashes-list"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
      >
        <ChevronDown
          id="stashes-toggle-chevron"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
        />
        <span id="stashes-title">Stashes</span>
        <span id="stashes-count" className="text-zinc-600">
          {stashes.length}
        </span>
      </button>
      {open ? (
      <ul id="stashes-list" className="min-h-0 flex-1 overflow-auto pb-2">
        {stashes.map((stash) => {
          const selected = stash.id === selectedId;
          const when = stashDate(stash.committedAt);
          return (
            <li id={domId("stash-item", stash.id)} key={stash.id}>
              <button
                id={domId("stash", stash.id)}
                type="button"
                aria-current={selected ? "true" : undefined}
                title={stash.pull ? PULL_TITLE : stash.message}
                onClick={() => onSelect(stash.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(stash.id);
                  setMenu({ stash, x: event.clientX, y: event.clientY });
                }}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-1 text-left hover:bg-zinc-800/80",
                  selected && "bg-sky-950/70",
                )}
              >
                <span id={domId("stash-message", stash.id)} className="flex w-full items-center gap-2">
                  <Archive id={domId("stash-glyph", stash.id)} className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                  <span id={domId("stash-label", stash.id)} className="truncate text-sm text-zinc-200">
                    {stash.message}
                  </span>
                </span>
                {when ? (
                  <span id={domId("stash-date", stash.id)} className="pl-5 text-xs text-zinc-500">
                    {when}
                  </span>
                ) : null}
              </button>
              {selected ? (
                <ul id={domId("stash-files", stash.id)} className="pb-1">
                  {filesLoading ? (
                    <li id={domId("stash-files-loading", stash.id)} className="px-8 py-1 text-xs text-zinc-500">
                      Loading files…
                    </li>
                  ) : files.length === 0 ? (
                    <li id={domId("stash-files-empty", stash.id)} className="px-8 py-1 text-xs text-zinc-500">
                      This stash has no files to compare.
                    </li>
                  ) : (
                    files.map((file) => {
                      const mark = statusMark(file.status);
                      const current = file.path === selectedPath;
                      return (
                        <li id={domId("stash-file-item", `${stash.id}-${file.path}`)} key={file.path}>
                          <button
                            id={domId("stash-file", `${stash.id}-${file.path}`)}
                            type="button"
                            aria-current={current ? "true" : undefined}
                            title={file.path}
                            onClick={() => onSelectFile(file.path)}
                            className={cn(
                              "flex w-full items-center gap-2 py-1 pr-3 pl-8 text-left text-sm hover:bg-zinc-800/80",
                              current && "bg-sky-950/70",
                            )}
                          >
                            <span
                              id={domId("stash-file-status", `${stash.id}-${file.path}`)}
                              title={mark.label}
                              aria-label={mark.label}
                              className={cn("w-4 shrink-0 text-center text-xs font-semibold", mark.className)}
                            >
                              {mark.letter}
                            </span>
                            <span
                              id={domId("stash-file-path", `${stash.id}-${file.path}`)}
                              className="truncate text-zinc-200"
                            >
                              {file.path}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      ) : null}
      {menu ? (
        <ContextMenu
          id="stash-menu"
          label={`Actions for ${menu.stash.message}`}
          x={menu.x}
          y={menu.y}
          scrollParentId="stashes-list"
          onClose={() => setMenu(null)}
        >
          <ContextMenuItem
            id="stash-menu-restore"
            icon={<ArchiveRestore id="stash-menu-restore-glyph" aria-hidden="true" />}
            label="Restore"
            title={pullLocked ? PULL_TITLE : "Put the changes back and remove the stash"}
            disabled={busy || pullLocked}
            onClick={() => {
              const stash = menu.stash;
              setMenu(null);
              setPending({ stash, action: "restore" });
            }}
          />
          <ContextMenuItem
            id="stash-menu-apply"
            icon={<FolderInput id="stash-menu-apply-glyph" aria-hidden="true" />}
            label="Apply"
            title={pullLocked ? PULL_TITLE : "Put the changes back and keep the stash"}
            disabled={busy || pullLocked}
            onClick={() => {
              const id = menu.stash.id;
              setMenu(null);
              onApply(id);
            }}
          />
          <ContextMenuSeparator id="stash-menu-separator-drop" />
          <ContextMenuItem
            id="stash-menu-drop"
            icon={<Trash2 id="stash-menu-drop-glyph" aria-hidden="true" />}
            label="Drop"
            title={pullLocked ? PULL_TITLE : "Delete the stash without restoring it"}
            danger
            disabled={busy || pullLocked}
            onClick={() => {
              const stash = menu.stash;
              setMenu(null);
              setPending({ stash, action: "drop" });
            }}
          />
        </ContextMenu>
      ) : null}
      <ActionConfirmDialog
        id="stash-restore-dialog"
        title="Restore stash"
        copy={
          pending?.action === "restore"
            ? `Restore “${pending.stash.message}”? The changes go back into the working tree and the stash is removed.`
            : ""
        }
        confirmLabel="Restore"
        open={pending?.action === "restore"}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending?.action !== "restore") {
            return;
          }
          const id = pending.stash.id;
          setPending(null);
          onRestore(id);
        }}
      />
      <ActionConfirmDialog
        id="stash-drop-dialog"
        title="Drop stash"
        copy={
          pending?.action === "drop"
            ? `Drop “${pending.stash.message}”? The stashed changes are deleted.`
            : ""
        }
        confirmLabel="Drop"
        confirmTone="destructive"
        open={pending?.action === "drop"}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending?.action !== "drop") {
            return;
          }
          const id = pending.stash.id;
          setPending(null);
          onDrop(id);
        }}
      />
    </section>
  );
}
