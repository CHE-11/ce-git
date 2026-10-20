import { useEffect, useRef, useState } from "react";
import type { BatchProgress } from "../../../../types/git";
import { Button } from "../Button";
import { Dialog } from "./Dialog";
import { GitSyncProgress } from "./GitSyncProgress";

type GitPullConfirmationDialogProps = {
  pullPaths: string[] | null;
  logs: BatchProgress[];
  error: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function GitPullConfirmationDialog({ pullPaths, logs, error, onClose, onConfirm }: GitPullConfirmationDialogProps) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const startedRef = useRef(false);
  const open = pullPaths !== null;
  const running = phase === "running";
  const entries = logs.filter((entry) => entry.action === "pull");
  const count = pullPaths?.length ?? 0;

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
    <Dialog id="pull-confirm-dialog" title={running ? "Pulling repositories" : phase === "done" ? "Pull finished" : "Pull repositories"} open={open} onClose={close}>
      {phase === "confirm" ? (
        <p id="pull-confirm-copy" className="text-sm text-zinc-300">
          Pull {count} repositories. A dirty working tree, or a repository that is already up to date, is skipped. Each repo&apos;s default branch is fast-forwarded from origin.
        </p>
      ) : (
        <GitSyncProgress id="pull-confirm-progress" label="Pulling" total={count} logs={entries} running={running} error={error} />
      )}
      <div id="pull-confirm-actions" className="mt-4 flex justify-end gap-2">
        {phase === "done" ? (
          <Button id="pull-confirm-close" variant="primary" onClick={onClose} onKeyDown={(event) => { if (event.key === "Enter") { onClose(); } }}>
            <span id="pull-confirm-close-label">Close</span>
            <kbd id="pull-confirm-close-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">  
              Enter
            </kbd>
          </Button>
        ) : (
          <>
            <Button id="pull-confirm-cancel" variant="ghost" onClick={close} disabled={running}>
              <span id="pull-confirm-cancel-label">Cancel</span>
            </Button>
            <Button id="pull-confirm-button" variant="primary" onClick={() => void confirm()} onKeyDown={(event) => { if (event.key === "Enter") { confirm(); } }} disabled={running}>
              <span id="pull-confirm-button-label">{running ? "Pulling…" : "Pull"}</span>
              <kbd id="pull-confirm-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
                Enter
              </kbd>
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
