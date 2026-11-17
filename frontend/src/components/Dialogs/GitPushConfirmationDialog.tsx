import { useEffect, useRef, useState } from "react";
import type { BatchProgress } from "../../../../types/git";
import { Button } from "../Button";
import { Dialog } from "./Dialog";
import { GitSyncProgress } from "./GitSyncProgress";

type SyncPhase = "confirm" | "running" | "done";

type GitPushConfirmationDialogProps = {
  pushPaths: string[] | null;
  visible: boolean;
  logs: BatchProgress[];
  error: string | null;
  onClose: () => void;
  onHide: () => void;
  onPhaseChange: (phase: SyncPhase) => void;
  onConfirm: () => void | Promise<void>;
};

export function GitPushConfirmationDialog({
  pushPaths,
  visible,
  logs,
  error,
  onClose,
  onHide,
  onPhaseChange,
  onConfirm,
}: GitPushConfirmationDialogProps) {
  const [phase, setPhase] = useState<SyncPhase>("confirm");
  const [sessionPaths, setSessionPaths] = useState(pushPaths);
  const startedRef = useRef(false);
  if (sessionPaths !== pushPaths) {
    setSessionPaths(pushPaths);
    setPhase("confirm");
    startedRef.current = false;
  }
  const open = visible && pushPaths !== null;
  const running = phase === "running";
  const entries = logs.filter((entry) => entry.action === "push");
  const count = pushPaths?.length ?? 0;

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  async function confirm() {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    setPhase("running");
    try {
      await onConfirm();
    } finally {
      if (startedRef.current) {
        setPhase("done");
      }
    }
  }

  function close() {
    if (phase === "confirm") {
      onClose();
      return;
    }
    onHide();
  }

  return (
    <Dialog
      id="push-confirm-dialog"
      title={running ? "Pushing repositories and gists" : phase === "done" ? "Push finished" : "Push repositories and gists"}
      open={open}
      onClose={close}
      onEnter={running ? undefined : phase === "done" ? onHide : () => void confirm()}
    >
      {phase === "confirm" ? (
        <p id="push-confirm-copy" className="text-sm text-zinc-300">
          Push {count} repositories to GitHub. Repos with nothing to push are skipped. A repository with no remote is created as a
          private GitHub repo when the GitHub CLI is signed in. GitHub gists are pushed with other GitHub remotes. Remotes on
          other hosts are skipped.
        </p>
      ) : (
        <GitSyncProgress id="push-confirm-progress" label="Pushing" total={count} logs={entries} running={running} error={error} />
      )}
      {running ? (
        <p id="push-confirm-hide-hint" className="mt-3 text-xs text-zinc-500">
          Hide this window and the push keeps running. Activity in the toolbar opens it again.
        </p>
      ) : null}
      <div id="push-confirm-actions" className="mt-4 flex justify-end gap-2">
        {phase === "done" ? (
          <Button id="push-confirm-close" variant="primary" autoFocus onClick={onHide} title="Close. Activity in the toolbar opens this again.">
            <span id="push-confirm-close-label">Close</span>
            <kbd id="push-confirm-close-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
              Enter
            </kbd>
          </Button>
        ) : running ? (
          <Button id="push-confirm-hide" variant="ghost" onClick={onHide} title="Hide this window. The push keeps running.">
            <span id="push-confirm-hide-label">Hide</span>
            <kbd id="push-confirm-hide-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
              Esc
            </kbd>
          </Button>
        ) : (
          <>
            <Button id="push-confirm-cancel" variant="ghost" onClick={close}>
              <span id="push-confirm-cancel-label">Cancel</span>
            </Button>
            <Button id="push-confirm-button" variant="primary" autoFocus onClick={() => void confirm()}>
              <span id="push-confirm-button-label">Push</span>
              <kbd id="push-confirm-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
                Enter
              </kbd>
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
