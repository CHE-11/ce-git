import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { messageOf, pickedFolderPath } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type CloneRepoDialogProps = {
  defaultParent?: string;
  onClose: () => void;
  onClone: (url: string, destination: string) => Promise<void>;
};

function repoNameFromUrl(url: string) {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const withoutGit = trimmed.replace(/\.git$/i, "");
  const segment = withoutGit.split(/[/:]/).pop()?.trim() ?? "";
  if (!segment || segment === "." || segment === "..") {
    return "";
  }
  if (/[<>:"/\\|?*]/.test(segment) || segment.startsWith("-")) {
    return "";
  }
  return segment;
}

function joinPath(parent: string, name: string) {
  const base = parent.trim().replace(/[\\/]+$/, "");
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${name.trim()}`;
}

export function CloneRepoDialog({ defaultParent = "", onClose, onClone }: CloneRepoDialogProps) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(defaultParent);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const requestClose = () => {
    if (cloning) {
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
        title: "Choose a folder to clone into",
        defaultPath: parent.trim() || undefined,
      });
      const path = pickedFolderPath(picked);
      if (path) {
        setParent(path);
      }
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const clone = async () => {
    const remote = url.trim();
    const folder = parent.trim();
    const folderName = name.trim();
    if (!remote) {
      setError("Enter a repository URL.");
      return;
    }
    if (!folder) {
      setError("Choose a parent folder.");
      return;
    }
    if (!folderName || folderName === "." || folderName === ".." || /[\\/:*?"<>|]/.test(folderName)) {
      setError("Enter a folder name without path separators.");
      return;
    }
    setCloning(true);
    setError(null);
    try {
      await onClone(remote, joinPath(folder, folderName));
      onClose();
    } catch (caught) {
      setError(messageOf(caught));
      setCloning(false);
    }
  };

  const canSubmit = url.trim().length > 0 && parent.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog id="clone-repo-dialog" title="Clone repository" open onClose={requestClose}>
      <form
        id="clone-repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void clone();
        }}
      >
        <p id="clone-repo-copy" className="text-sm text-zinc-300">
          Clone a Git remote into a new folder. If that folder is not already under an open workspace folder, it is
          added to the tree.
        </p>
        <label
          id="clone-repo-url-label"
          htmlFor="clone-repo-url-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Repository URL
        </label>
        <input
          id="clone-repo-url-input"
          value={url}
          onChange={(event) => {
            const next = event.target.value;
            setUrl(next);
            setError(null);
            if (!nameEdited) {
              setName(repoNameFromUrl(next));
            }
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="https://github.com/owner/repo.git"
          className={`${fieldClass} w-full`}
        />
        <label
          id="clone-repo-parent-label"
          htmlFor="clone-repo-parent-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Parent folder
        </label>
        <div id="clone-repo-parent-row" className="flex gap-2">
          <input
            id="clone-repo-parent-input"
            value={parent}
            onChange={(event) => {
              setParent(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={cloning}
            placeholder="Select a folder"
            className={fieldClass}
          />
          <Button id="clone-repo-browse" onClick={() => void browse()} disabled={cloning}>
            <span id="clone-repo-browse-label">Browse</span>
          </Button>
        </div>
        <label
          id="clone-repo-name-label"
          htmlFor="clone-repo-name-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folder name
        </label>
        <input
          id="clone-repo-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameEdited(true);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="repo"
          className={`${fieldClass} w-full`}
        />
        <p id="clone-repo-hint" className="mt-1 text-xs text-zinc-500">
          The parent folder must already exist. The new folder must not.
        </p>
        {error ? (
          <p id="clone-repo-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div id="clone-repo-actions" className="mt-4 flex justify-end gap-2">
          <Button id="clone-repo-cancel" variant="ghost" onClick={requestClose} disabled={cloning}>
            <span id="clone-repo-cancel-label">Cancel</span>
          </Button>
          <Button id="clone-repo-submit" variant="primary" type="submit" disabled={cloning || !canSubmit}>
            <span id="clone-repo-submit-label">{cloning ? "Cloning…" : "Clone repository"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
