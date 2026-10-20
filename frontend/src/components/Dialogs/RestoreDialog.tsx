import { useEffect, useState } from "react";
import type { HiddenTreeItem } from "../../lib/tree";
import { domId, pathEquals } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

type RestoreDialogProps = {
  open: boolean;
  items: HiddenTreeItem[];
  onClose: () => void;
  onRestore: (paths: string[]) => Promise<boolean>;
};

const sections: { id: string; label: string; kind: HiddenTreeItem["kind"] }[] = [
  { id: "folders", label: "Folders", kind: "folder" },
  { id: "repos", label: "Repositories", kind: "repo" },
  { id: "missing", label: "Not found", kind: null },
];

function includesPath(paths: readonly string[], path: string) {
  return paths.some((item) => pathEquals(item, path));
}

export function RestoreDialog({ open, items, onClose, onRestore }: RestoreDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const allChecked = items.length > 0 && items.every((item) => includesPath(selected, item.path));
  const someChecked = items.some((item) => includesPath(selected, item.path));

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setRestoring(false);
    }
  }, [open]);

  useEffect(() => {
    setSelected((current) => current.filter((path) => items.some((item) => pathEquals(item.path, path))));
  }, [items]);

  function toggle(path: string) {
    setSelected((current) => (includesPath(current, path) ? current.filter((item) => !pathEquals(item, path)) : [...current, path]));
  }

  async function restore() {
    if (selected.length === 0 || restoring) {
      return;
    }
    setRestoring(true);
    try {
      const restored = await onRestore(selected);
      if (restored) {
        onClose();
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog
      id="restore-dialog"
      title="Restore hidden items"
      open={open}
      onClose={() => {
        if (!restoring) {
          onClose();
        }
      }}
      onEnter={selected.length === 0 || restoring ? undefined : () => void restore()}
    >
      <p id="restore-dialog-copy" className="text-sm text-zinc-300">
        Choose the folders and repositories to show in the tree again. Hidden items that stay unchecked remain hidden.
      </p>
      {items.length === 0 ? (
        <p id="restore-dialog-empty" className="mt-3 text-sm text-zinc-500">
          Nothing is hidden in the open folders.
        </p>
      ) : (
        <div id="restore-dialog-list" className="mt-3 flex flex-col gap-3">
          <label id="restore-select-all-row" className="flex cursor-pointer items-center gap-2 px-2 text-sm text-zinc-300">
            <input
              id="restore-select-all"
              type="checkbox"
              className="size-3.5 accent-sky-500"
              checked={allChecked}
              disabled={restoring}
              ref={(element) => {
                if (element) {
                  element.indeterminate = someChecked && !allChecked;
                }
              }}
              onChange={() => setSelected(allChecked ? [] : items.map((item) => item.path))}
            />
            <span id="restore-select-all-label">Select all</span>
          </label>
          {sections.map((section) => {
            const listed = items.filter((item) => item.kind === section.kind);
            if (listed.length === 0) {
              return null;
            }
            return (
              <section id={`restore-section-${section.id}`} key={section.id}>
                <h3 id={`restore-section-${section.id}-heading`} className="px-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  {section.label}
                </h3>
                <ul id={`restore-section-${section.id}-list`} className="mt-1">
                  {listed.map((item) => {
                    const checked = includesPath(selected, item.path);
                    return (
                      <li id={domId("restore-item", item.path)} key={item.path}>
                        <label
                          id={domId("restore-item-row", item.path)}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800/80"
                        >
                          <input
                            id={domId("restore-item-check", item.path)}
                            type="checkbox"
                            className="mt-0.5 size-3.5 shrink-0 accent-sky-500"
                            checked={checked}
                            disabled={restoring}
                            onChange={() => toggle(item.path)}
                          />
                          <span id={domId("restore-item-text", item.path)} className="min-w-0">
                            <span id={domId("restore-item-name", item.path)} className="block text-sm text-zinc-100">
                              {item.name}
                            </span>
                            <span
                              id={domId("restore-item-path", item.path)}
                              className="block truncate font-mono text-xs text-zinc-500"
                              title={item.path}
                            >
                              {item.path}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <div id="restore-dialog-actions" className="mt-4 flex justify-end gap-2">
        <Button id="restore-dialog-cancel" variant="ghost" onClick={onClose} disabled={restoring}>
          <span id="restore-dialog-cancel-label">{items.length === 0 ? "Close" : "Cancel"}</span>
        </Button>
        {items.length > 0 ? (
          <Button
            id="restore-dialog-confirm"
            variant="primary"
            onClick={() => void restore()}
            disabled={restoring || selected.length === 0}
          >
            <span id="restore-dialog-confirm-label">
              {restoring ? "Restoring…" : selected.length === 0 ? "Restore" : `Restore ${selected.length}`}
            </span>
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
