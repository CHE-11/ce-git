import { useEffect, useRef, useState } from "react";
import type { BatchProgress } from "../../../../types/git";
import { editorById, openInLabel, type EditorId } from "../../lib/editors";
import { EditorIcon } from "../EditorIcon";
import { Button } from "../Button";
import { Dialog } from "./Dialog";
import { GitSyncProgress } from "./GitSyncProgress";

type SyncPhase = "confirm" | "running" | "done";

type GitPullConfirmationDialogProps = {
  pullPaths: string[] | null;
  visible: boolean;
  logs: BatchProgress[];
  error: string | null;
  editor: EditorId;
  onClose: () => void;
  onHide: () => void;
  onPhaseChange: (phase: SyncPhase) => void;
  onConfirm: () => void | Promise<void>;
  onOpenConflict: (path: string) => void | Promise<void>;
  onFinishMerge: (path: string) => void | Promise<void>;
  onAbortMerge: (path: string) => void | Promise<void>;
};

export function GitPullConfirmationDialog({
  pullPaths,
  visible,
  logs,
  error,
  editor,
  onClose,
  onHide,
  onPhaseChange,
  onConfirm,
  onOpenConflict,
  onFinishMerge,
  onAbortMerge,
}: GitPullConfirmationDialogProps) {
  const [phase, setPhase] = useState<SyncPhase>("confirm");
  const [workingPath, setWorkingPath] = useState<string | null>(null);
  const [sessionPaths, setSessionPaths] = useState(pullPaths);
  const startedRef = useRef(false);
  if (sessionPaths !== pullPaths) {
    setSessionPaths(pullPaths);
    setPhase("confirm");
    setWorkingPath(null);
    startedRef.current = false;
  }
  const open = visible && pullPaths !== null;
  const running = phase === "running";
  const entries = logs.filter((entry) => entry.action === "pull");
  const conflicts = entries.filter((entry) => entry.status === "conflict" && entry.path);
  const count = pullPaths?.length ?? 0;
  const chosenEditor = editorById(editor);
  const editorLabel = openInLabel(chosenEditor);
  const editorName = chosenEditor.id === "default" ? "your default editor" : chosenEditor.label;
  const working = workingPath !== null;

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

  async function runConflictAction(action: (path: string) => void | Promise<void>, path: string) {
    if (working) {
      return;
    }
    setWorkingPath(path);
    try {
      await action(path);
    } finally {
      setWorkingPath(null);
    }
  }

  const finishedClean = phase === "done" && conflicts.length === 0;

  return (
    <Dialog
      id="pull-confirm-dialog"
      title={running ? "Pulling repositories" : phase === "done" ? "Pull finished" : "Pull repositories"}
      open={open}
      onClose={close}
      onEnter={running || working ? undefined : phase === "done" ? (finishedClean ? onHide : undefined) : () => void confirm()}
    >
      {phase === "confirm" ? (
        <p id="pull-confirm-copy" className="text-sm text-zinc-300">
          Pull {count} repositories from each default branch. A repository that is already up to date is skipped. Local
          edits stay put when the incoming commits do not touch those files. When they do, those edits are stashed, the
          commits are pulled, and the edits are put back. If putting them back conflicts, edit the files so your changes
          fit, then finish. A branch that is only behind is fast-forwarded. If the checked-out branch is also ahead, the
          incoming commits are merged and local commits stay. If that merge conflicts, open the repository in {editorName},
          resolve the files, and finish.
        </p>
      ) : (
        <GitSyncProgress id="pull-confirm-progress" label="Pulling" total={count} logs={entries} running={running} error={error} />
      )}
      {phase === "done" && conflicts.length > 0 ? (
        <section id="pull-conflicts" className="mt-4 rounded-md border border-violet-900 bg-violet-950/40 px-3 py-3">
          <h3 id="pull-conflicts-title" className="text-sm font-medium text-violet-100">
            Conflicts
          </h3>
          <p id="pull-conflicts-copy" className="mt-1 text-sm leading-5 text-zinc-300">
            {editorLabel} and edit the files so the changes fit together, then finish. Abort puts the repository back to
            where it was before the pull.
          </p>
          <ul id="pull-conflicts-list" className="mt-3 flex flex-col gap-2">
            {conflicts.map((entry, index) => (
              <li
                id={`pull-conflict-${index}`}
                key={entry.path}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2"
              >
                <p id={`pull-conflict-${index}-repo`} className="truncate text-sm text-zinc-100">
                  {entry.repo}
                </p>
                <p id={`pull-conflict-${index}-message`} className="mt-0.5 text-xs leading-5 text-zinc-400">
                  {entry.message}
                </p>
                <div id={`pull-conflict-${index}-actions`} className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button
                    id={`pull-conflict-${index}-abort`}
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    onClick={() => void runConflictAction(onAbortMerge, entry.path)}
                  >
                    <span id={`pull-conflict-${index}-abort-label`}>Abort</span>
                  </Button>
                  <Button
                    id={`pull-conflict-${index}-open`}
                    variant="outline"
                    size="sm"
                    autoFocus={index === 0}
                    disabled={working}
                    onClick={() => void runConflictAction(onOpenConflict, entry.path)}
                  >
                    <EditorIcon id={`pull-conflict-${index}-open-icon`} editor={editor} />
                    <span id={`pull-conflict-${index}-open-label`}>{editorLabel}</span>
                  </Button>
                  <Button
                    id={`pull-conflict-${index}-finish`}
                    variant="primary"
                    size="sm"
                    disabled={working}
                    onClick={() => void runConflictAction(onFinishMerge, entry.path)}
                  >
                    <span id={`pull-conflict-${index}-finish-label`}>
                      {workingPath === entry.path ? "Working…" : "Finish"}
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {running ? (
        <p id="pull-confirm-hide-hint" className="mt-3 text-xs text-zinc-500">
          Hide this window and the pull keeps running. Activity in the toolbar opens it again.
        </p>
      ) : null}
      <div id="pull-confirm-actions" className="mt-4 flex justify-end gap-2">
        {phase === "done" ? (
          <Button
            id="pull-confirm-close"
            variant={conflicts.length > 0 ? "ghost" : "primary"}
            autoFocus={conflicts.length === 0}
            onClick={onHide}
            title="Close. Activity in the toolbar opens this again."
          >
            <span id="pull-confirm-close-label">Close</span>
            {conflicts.length === 0 ? (
              <kbd id="pull-confirm-close-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
                Enter
              </kbd>
            ) : null}
          </Button>
        ) : running ? (
          <Button id="pull-confirm-hide" variant="ghost" onClick={onHide} title="Hide this window. The pull keeps running.">
            <span id="pull-confirm-hide-label">Hide</span>
            <kbd id="pull-confirm-hide-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
              Esc
            </kbd>
          </Button>
        ) : (
          <>
            <Button id="pull-confirm-cancel" variant="ghost" onClick={close}>
              <span id="pull-confirm-cancel-label">Cancel</span>
            </Button>
            <Button id="pull-confirm-button" variant="primary" autoFocus onClick={() => void confirm()}>
              <span id="pull-confirm-button-label">Pull</span>
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
