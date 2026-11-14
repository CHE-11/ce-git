import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import type { GistPublishOptions } from "../../../../types/git";
import { messageOf, pickedFolderPath } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

const VISIBILITY: { secret: boolean; label: string; hint: string }[] = [
  { secret: true, label: "Secret", hint: "Hidden from listings. Anyone with the link can view it" },
  { secret: false, label: "Public", hint: "Anyone on the internet" },
];

type CreateGistDialogProps = {
  onClose: () => void;
  onCreate: (path: string, options: GistPublishOptions) => Promise<void>;
};

export function CreateGistDialog({ onClose, onCreate }: CreateGistDialogProps) {
  const [folder, setFolder] = useState("");
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState(true);
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
        title: "Choose a folder to publish as a gist",
        defaultPath: folder.trim() || undefined,
      });
      const path = pickedFolderPath(picked);
      if (path) {
        setFolder(path);
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
    if ([...description.trim()].length > 256) {
      setError("Description must be 256 characters or fewer.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(path, { description: description.trim(), secret });
      onClose();
    } catch (caught) {
      setError(messageOf(caught));
      setCreating(false);
    }
  };

  return (
    <Dialog id="create-gist-dialog" title={creating ? "Creating gist" : "Create gist"} open onClose={requestClose}>
      <form
        id="create-gist-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <p id="create-gist-copy" className="text-sm text-zinc-300">
          Choose a folder on disk. ce-git publishes it as a GitHub gist and adds it to the tree when it is not already
          under an open workspace folder. A folder with no commits is committed first.
        </p>
        <label
          id="create-gist-folder-label"
          htmlFor="create-gist-folder-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folder
        </label>
        <div id="create-gist-folder-row" className="flex gap-2">
          <input
            id="create-gist-folder-input"
            value={folder}
            onChange={(event) => {
              setFolder(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={creating}
            placeholder="Select a folder"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50"
          />
          <Button id="create-gist-browse" onClick={() => void browse()} disabled={creating}>
            <span id="create-gist-browse-label">Browse</span>
          </Button>
        </div>
        <label
          id="create-gist-description-label"
          htmlFor="create-gist-description-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Description
        </label>
        <textarea
          id="create-gist-description-input"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setError(null);
          }}
          rows={3}
          disabled={creating}
          placeholder="Shown as the gist title"
          className={fieldClass}
        />
        <p id="create-gist-description-hint" className="mt-1 text-xs text-zinc-500">
          256 characters or fewer.
        </p>
        <fieldset id="create-gist-visibility" className="mt-4" disabled={creating}>
          <legend id="create-gist-visibility-legend" className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Visibility
          </legend>
          <div id="create-gist-visibility-options" className="grid grid-cols-2 gap-2">
            {VISIBILITY.map((option) => {
              const selected = secret === option.secret;
              const slug = option.secret ? "secret" : "public";
              return (
                <label
                  id={`create-gist-visibility-${slug}`}
                  key={slug}
                  className={
                    selected
                      ? "cursor-pointer rounded-md border border-sky-500 bg-sky-950/40 px-2 py-2"
                      : "cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 hover:border-zinc-500"
                  }
                >
                  <input
                    id={`create-gist-visibility-${slug}-input`}
                    type="radio"
                    name="create-gist-visibility"
                    value={slug}
                    checked={selected}
                    onChange={() => {
                      setSecret(option.secret);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <span id={`create-gist-visibility-${slug}-label`} className="block text-sm font-medium text-zinc-100">
                    {option.label}
                  </span>
                  <span id={`create-gist-visibility-${slug}-hint`} className="mt-0.5 block text-xs text-zinc-500">
                    {option.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {error ? (
          <p id="create-gist-error" className="mt-3 text-sm whitespace-pre-wrap text-red-400">
            {error}
          </p>
        ) : null}
        <div id="create-gist-actions" className="mt-4 flex justify-end gap-2">
          <Button id="create-gist-cancel" variant="ghost" onClick={requestClose} disabled={creating}>
            <span id="create-gist-cancel-label">Cancel</span>
          </Button>
          <Button id="create-gist-submit" variant="primary" type="submit" disabled={creating || folder.trim().length === 0}>
            <span id="create-gist-submit-label">{creating ? "Creating…" : "Create gist"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
