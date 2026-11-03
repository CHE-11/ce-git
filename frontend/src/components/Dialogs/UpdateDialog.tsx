import { Button } from "../Button";
import { Dialog } from "./Dialog";
import type { UpdateDialogMode } from "../../lib/use-app-update";

type UpdateDialogProps = {
  open: boolean;
  mode: UpdateDialogMode;
  version: string;
  notes: string;
  progress: number | null;
  error: string | null;
  onClose: () => void;
  onInstall: () => void;
};

export function UpdateDialog({ open, mode, version, notes, progress, error, onClose, onInstall }: UpdateDialogProps) {
  const downloading = mode === "downloading";
  const title = dialogTitle(mode);
  const confirm = mode === "update" ? onInstall : undefined;

  return (
    <Dialog id="update-dialog" title={title} open={open} onClose={onClose} onEnter={confirm} panelClassName="max-w-lg">
      {mode === "update" || mode === "downloading" || mode === "notes" ? (
        <>
          <p id="update-dialog-version" className="text-sm text-zinc-400">
            {mode === "notes" ? `ce-git ${version}` : `Version ${version} is ready to install.`}
          </p>
          <pre id="update-dialog-notes" className="mt-3 max-h-64 overflow-auto font-sans text-sm whitespace-pre-wrap text-zinc-200">
            {notes || "No release notes were published."}
          </pre>
        </>
      ) : null}

      {mode === "current" ? (
        <p id="update-dialog-current" className="text-sm text-zinc-300">
          ce-git {version} is the latest version.
        </p>
      ) : null}

      {mode === "error" && error ? (
        <p id="update-dialog-error" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {downloading ? (
        <div id="update-dialog-progress" className="mt-4">
          <div id="update-dialog-progress-track" className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              id="update-dialog-progress-bar"
              className={progress === null ? "h-full w-1/3 animate-pulse bg-sky-500" : "h-full bg-sky-500 transition-[width]"}
              style={progress === null ? undefined : { width: `${progress}%` }}
            />
          </div>
          <p id="update-dialog-progress-label" className="mt-2 text-xs text-zinc-400">
            {progress === null ? "Downloading…" : `Downloading… ${progress}%`}
          </p>
        </div>
      ) : null}

      {downloading ? null : (
        <div id="update-dialog-actions" className="mt-4 flex justify-end gap-2">
          {mode === "update" ? (
            <Button id="update-dialog-later" variant="ghost" onClick={onClose}>
              <span id="update-dialog-later-label">Later</span>
            </Button>
          ) : (
            <Button id="update-dialog-close" variant="ghost" onClick={onClose}>
              <span id="update-dialog-close-label">Close</span>
            </Button>
          )}
          {mode === "update" ? (
            <Button id="update-dialog-install" variant="primary" autoFocus onClick={onInstall}>
              <span id="update-dialog-install-label">Update</span>
            </Button>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function dialogTitle(mode: UpdateDialogMode) {
  if (mode === "notes") {
    return "What's new";
  }
  if (mode === "downloading") {
    return "Updating";
  }
  if (mode === "current") {
    return "Up to date";
  }
  if (mode === "error") {
    return "Update";
  }
  return "Update available";
}
