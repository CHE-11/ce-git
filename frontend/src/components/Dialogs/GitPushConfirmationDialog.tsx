import { useEffect, useRef, useState } from "react";
import type { BatchProgress } from "../../../../types/git";
import { Button } from "../Button";
import { Dialog } from "./Dialog";
import { GitSyncProgress } from "./GitSyncProgress";

type GitPushConfirmationDialogProps = {
  pushPaths: string[] | null;
  logs: BatchProgress[];
  error: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function GitPushConfirmationDialog({ pushPaths, logs, error, onClose, onConfirm }: GitPushConfirmationDialogProps) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const startedRef = useRef(false);
  const open = pushPaths !== null;
  const running = phase === "running";
  const entries = logs.filter((entry) => entry.action === "push");
  const count = pushPaths?.length ?? 0;

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setPhase("confirm");
    }
  }, [open]);

  async function confirm() {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    setPhase("running");
    try {
      await onConfirm();
    } finally {
      setPhase("done");
    }
  }

  function close() {
    if (running) {
      return;
    }
    onClose();
  }

  return (
    <Dialog id="push-confirm-dialog" title={running ? "Pushing repositories" : phase === "done" ? "Push finished" : "Push repositories"} open={open} onClose={close}>
      {phase === "confirm" ? (
        <p id="push-confirm-copy" className="text-sm text-zinc-300">
          Push {count} repositories to GitHub. Repos with nothing to push are skipped. A repository with no remote is created as a
          private GitHub repo when the GitHub CLI is signed in. Remotes that are not GitHub are skipped.
        </p>
      ) : (
        <GitSyncProgress id="push-confirm-progress" label="Pushing" total={count} logs={entries} running={running} error={error} />
      )}
      <div id="push-confirm-actions" className="mt-4 flex justify-end gap-2">
        {phase === "done" ? (
          <Button id="push-confirm-close" variant="primary" onClick={onClose}>
            <span id="push-confirm-close-label">Close</span>
          </Button>
        ) : (
          <>
            <Button id="push-confirm-cancel" variant="ghost" onClick={close} disabled={running}>
              <span id="push-confirm-cancel-label">Cancel</span>
            </Button>
            <Button id="push-confirm-button" variant="primary" onClick={() => void confirm()} disabled={running}>
              <span id="push-confirm-button-label">{running ? "Pushing…" : "Push"}</span>
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
