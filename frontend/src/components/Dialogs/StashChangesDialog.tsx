import { useState } from "react";
import type { FileChange } from "../../../../types/git";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500";

type StashChangesDialogProps = {
  files: FileChange[];
  open: boolean;
  onClose: () => void;
  onConfirm: (message: string) => void;
};

function defaultStashMessage(files: FileChange[]) {
  if (files.length === 1) {
    return files[0]?.path ?? "";
  }
  return `${files.length} files`;
}

export function StashChangesDialog({ files, open, onClose, onConfirm }: StashChangesDialogProps) {
  const [message, setMessage] = useState(() => defaultStashMessage(files));
  const [error, setError] = useState<string | null>(null);
  const count = files.length;
  const copy =
    count === 1
      ? `Stash ${files[0]?.path ?? "this file"}? It leaves the working tree until you restore it.`
      : `Stash ${count} files? They leave the working tree until you restore them.`;

  function confirm() {
    const next = message.trim();
    if (!next) {
      setError("Enter a stash message.");
      return;
    }
    if (next.includes("ce-git pull")) {
      setError("That message is reserved for an in-progress pull.");
      return;
    }
    onConfirm(next);
  }

  return (
    <Dialog id="stash-changes-dialog" title="Stash changes" open={open} onClose={onClose}>
      <p id="stash-changes-copy" className="text-sm wrap-break-word text-zinc-300">
        {copy}
      </p>
      <label
        id="stash-changes-message-label"
        htmlFor="stash-changes-message"
        className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
      >
        Message
      </label>
      <input
        id="stash-changes-message"
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            confirm();
          }
        }}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        className={fieldClass}
      />
      {error ? (
        <p id="stash-changes-error" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <div id="stash-changes-actions" className="mt-4 flex justify-end gap-2">
        <Button id="stash-changes-cancel" variant="ghost" onClick={onClose}>
          <span id="stash-changes-cancel-label">Cancel</span>
        </Button>
        <Button id="stash-changes-confirm" onClick={confirm}>
          <span id="stash-changes-confirm-label">Stash</span>
        </Button>
      </div>
    </Dialog>
  );
}
