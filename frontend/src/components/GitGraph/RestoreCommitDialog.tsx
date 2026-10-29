import { Button } from "../Button";
import { Dialog } from "../Dialogs/Dialog";

export type RestoreRequest = { kind: "files"; paths: string[] } | { kind: "tree" } | { kind: "branch" };

type RestoreCommitDialogProps = {
  request: RestoreRequest | null;
  hash: string;
  subject: string;
  isHead: boolean;
  working: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

function shortHash(hash: string) {
  return hash.slice(0, 7);
}

function title(request: RestoreRequest) {
  if (request.kind === "branch") return "Move branch to this commit";
  if (request.kind === "tree") return "Restore the repo to this commit";
  return request.paths.length === 1 ? "Restore this file" : "Restore these files";
}

function confirmLabel(request: RestoreRequest) {
  if (request.kind === "branch") return "Move branch";
  if (request.kind === "tree") return "Restore repo";
  return request.paths.length === 1 ? "Restore file" : `Restore ${request.paths.length} files`;
}

export function RestoreCommitDialog({ request, hash, subject, isHead, working, error, onClose, onConfirm }: RestoreCommitDialogProps) {
  const label = subject.trim() || "(no message)";
  const shown = request?.kind === "files" ? request.paths.slice(0, 8) : [];
  const hidden = request?.kind === "files" ? Math.max(0, request.paths.length - shown.length) : 0;

  return (
    <Dialog
      id="restore-commit-dialog"
      title={request ? title(request) : "Restore"}
      open={request !== null}
      onClose={working ? () => undefined : onClose}
      onEnter={working || !request ? undefined : onConfirm}
    >
      {request?.kind === "branch" ? (
        <p id="restore-commit-dialog-copy" className="text-sm wrap-break-word text-zinc-300">
          {isHead
            ? `${shortHash(hash)} is already the tip of this branch. Uncommitted changes will be discarded so the files match “${label}”.`
            : `The current branch will point at ${shortHash(hash)}, “${label}”. Later commits that are only on this branch drop off it, and uncommitted changes are discarded.`}
        </p>
      ) : request?.kind === "tree" ? (
        <p id="restore-commit-dialog-copy" className="text-sm wrap-break-word text-zinc-300">
          Every tracked file will match {shortHash(hash)}, “{label}”. The branch stays where it is, so you can review the result and commit it. Uncommitted edits to tracked files are replaced. Files that
          were never committed stay on disk.
        </p>
      ) : (
        <p id="restore-commit-dialog-copy" className="text-sm wrap-break-word text-zinc-300">
          {request?.paths.length === 1 ? "This file will match" : "These files will match"} {shortHash(hash)}. Everything else stays as it is. A file that did not exist in that commit is removed, including
          uncommitted edits to it.
        </p>
      )}
      {request?.kind === "files" ? (
        <ul id="restore-commit-dialog-files" className="mt-3 max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/60 py-1">
          {shown.map((path, index) => (
            <li id={`restore-commit-dialog-file-${index}`} key={path} className="truncate px-2 py-0.5 font-mono text-xs text-zinc-300" title={path}>
              {path}
            </li>
          ))}
          {hidden > 0 ? (
            <li id="restore-commit-dialog-more" className="px-2 py-0.5 text-xs text-zinc-500">
              and {hidden} more
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? (
        <p id="restore-commit-dialog-error" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <div id="restore-commit-dialog-actions" className="mt-4 flex justify-end gap-2">
        <Button id="restore-commit-dialog-cancel" variant="ghost" onClick={onClose} disabled={working}>
          <span id="restore-commit-dialog-cancel-label">Cancel</span>
        </Button>
        <Button
          id="restore-commit-dialog-confirm"
          variant={request?.kind === "branch" ? "destructive" : "primary"}
          autoFocus
          disabled={working || !request}
          onClick={onConfirm}
        >
          <span id="restore-commit-dialog-confirm-label">{working ? "Working…" : request ? confirmLabel(request) : "Restore"}</span>
          {working ? null : (
            <kbd id="restore-commit-dialog-confirm-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
              Enter
            </kbd>
          )}
        </Button>
      </div>
    </Dialog>
  );
}
