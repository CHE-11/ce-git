import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { messageOf } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type CreateRepoDialogProps = {
  onClose: () => void;
  onCreate: (path: string) => Promise<void>;
};

export function CreateRepoDialog({ onClose, onCreate }: CreateRepoDialogProps) {
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const requestClose = () => {
    if (creating) {
      return;
    }
    onClose();
  };

  const browse = async () => {
    setError(null);
    try {
      const picked = await openFolder({
        directory: true,
        multiple: false,
        title: "Choose a folder to initialize",
        defaultPath: folder.trim() || undefined,
      });
      if (typeof picked === "string") {
        setFolder(picked);
      }
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const create = async () => {
    const path = folder.trim();
    if (!path) {
      setError("Choose a folder on disk.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(path);
      onClose();
    } catch (caught) {
      setError(messageOf(caught));
      setCreating(false);
    }
  };

  return (
    <Dialog id="create-repo-dialog" title="Create repository" open onClose={requestClose}>
      <form
        id="create-repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <p id="create-repo-copy" className="text-sm text-zinc-300">
          Choose a folder on disk. ce-git initializes a Git repository there. If that folder is not already under an
          open workspace folder, it is added to the tree.
        </p>
        <label
          id="create-repo-folder-label"
          htmlFor="create-repo-folder-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folder
        </label>
        <div id="create-repo-folder-row" className="flex gap-2">
          <input
            id="create-repo-folder-input"
            value={folder}
            onChange={(event) => {
              setFolder(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={creating}
            placeholder="Select a folder"
            className={fieldClass}
          />
          <Button id="create-repo-browse" onClick={() => void browse()} disabled={creating}>
            <span id="create-repo-browse-label">Browse</span>
          </Button>
        </div>
        <p id="create-repo-hint" className="mt-1 text-xs text-zinc-500">
          The folder must already exist and must not already be a Git repository.
        </p>
        {error ? (
          <p id="create-repo-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div id="create-repo-actions" className="mt-4 flex justify-end gap-2">
          <Button id="create-repo-cancel" variant="ghost" onClick={requestClose} disabled={creating}>
            <span id="create-repo-cancel-label">Cancel</span>
          </Button>
          <Button id="create-repo-submit" variant="primary" type="submit" disabled={creating || folder.trim().length === 0}>
            <span id="create-repo-submit-label">{creating ? "Creating…" : "Create repository"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
