import type { AiCommitDraft, BatchProgress } from "../../../../types/git";
import { domId } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";
import { GitSyncProgress } from "./GitSyncProgress";

type Props = {
  open: boolean;
  drafts: AiCommitDraft[];
  generating: boolean;
  busy: boolean;
  aiAction: "commit" | "push" | "refresh" | null;
  logs: BatchProgress[];
  pushPhase: "idle" | "running" | "done";
  pushTotal: number;
  pushError: string | null;
  error: string | null;
  onClose: () => void;
  onChange: (path: string, patch: { message?: string; description?: string }) => void;
  onToggle: (path: string) => void;
  onSave: () => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
};

export function AiCommitDialog({
  open,
  drafts,
  generating,
  busy,
  aiAction,
  logs,
  pushPhase,
  pushTotal,
  pushError,
  error,
  onClose,
  onChange,
  onToggle,
  onSave,
  onCommit,
  onCommitAndPush,
}: Props) {
  const ready = drafts.some((draft) => draft.include && !draft.error && draft.message.trim().length > 0);
  const locked = busy || generating || !ready;
  const showingPush = pushPhase === "running" || pushPhase === "done";
  const pushing = pushPhase === "running";
  const pushLogs = logs.filter((entry) => entry.action === "push");

  function close() {
    if (pushing) {
      return;
    }
    onClose();
  }

  const title = pushing ? "Pushing repositories" : pushPhase === "done" ? "Push finished" : "Review AI commit messages";

  return (
    <Dialog
      id="ai-review-dialog"
      title={title}
      open={open}
      onClose={close}
      onEnter={pushPhase === "done" ? onClose : undefined}
    >
      {showingPush ? (
        <GitSyncProgress
          id="ai-review-progress"
          label="Pushing"
          total={pushTotal}
          logs={pushLogs}
          running={pushing}
          error={error ?? pushError}
        />
      ) : (
        <>
          <p id="ai-review-note" className="mb-3 text-sm text-zinc-400">
            {generating
              ? "Generating messages…"
              : "Edit any message. Uncheck a repository to leave it out, then save or commit."}
          </p>
          <div id="ai-review-list" className="flex flex-col gap-3">
            {drafts.map((draft) => (
              <article id={domId("ai-draft", draft.path)} key={draft.path} className="rounded-md border border-zinc-800 p-3">
                <div id={domId("ai-draft-header", draft.path)} className="mb-2 flex items-center gap-2">
                  <input
                    id={domId("ai-draft-check", draft.path)}
                    type="checkbox"
                    className="size-3.5 accent-violet-500"
                    checked={draft.include}
                    onChange={() => onToggle(draft.path)}
                  />
                  <h3 id={domId("ai-draft-name", draft.path)} className="text-sm font-medium text-zinc-100">
                    {draft.name}
                  </h3>
                </div>
                <p id={domId("ai-draft-path", draft.path)} className="mb-2 truncate text-xs text-zinc-500" title={draft.path}>
                  {draft.path}
                </p>
                {draft.error ? (
                  <p id={domId("ai-draft-error", draft.path)} className="text-sm text-red-400">
                    {draft.error}
                  </p>
                ) : (
                  <div id={domId("ai-draft-fields", draft.path)} className="flex flex-col gap-2">
                    <label id={domId("ai-draft-message-label", draft.path)} htmlFor={domId("ai-draft-message", draft.path)} className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      Commit message
                    </label>
                    <textarea
                      id={domId("ai-draft-message", draft.path)}
                      value={draft.message}
                      onChange={(event) => onChange(draft.path, { message: event.target.value })}
                      rows={2}
                      className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                    />
                    <label id={domId("ai-draft-description-label", draft.path)} htmlFor={domId("ai-draft-description", draft.path)} className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      Description
                    </label>
                    <textarea
                      id={domId("ai-draft-description", draft.path)}
                      value={draft.description}
                      onChange={(event) => onChange(draft.path, { description: event.target.value })}
                      rows={4}
                      className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
          {error ? (
            <p id="ai-review-error" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </>
      )}
      <div id="ai-review-actions" className="sticky bottom-0 -mx-4 mt-4 -mb-3 flex flex-wrap justify-end gap-2 border-t border-zinc-800 bg-zinc-900 px-4 py-3">
        {showingPush ? (
          pushPhase === "done" ? (
            <Button id="ai-review-push-close" variant="primary" autoFocus onClick={onClose}>
              <span id="ai-review-push-close-label">Close</span>
              <kbd id="ai-review-push-close-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
                Enter
              </kbd>
            </Button>
          ) : (
            <>
              <Button id="ai-review-cancel" variant="ghost" onClick={close} disabled>
                <span id="ai-review-cancel-label">Cancel</span>
              </Button>
              <Button id="ai-review-commit-push" variant="primary" disabled className="bg-emerald-600 hover:bg-emerald-500">
                <span id="ai-review-commit-push-label">{aiAction === "refresh" ? "Refreshing…" : "Pushing…"}</span>
              </Button>
            </>
          )
        ) : (
          <>
            <Button id="ai-review-cancel" variant="ghost" onClick={onClose} disabled={busy}>
              <span id="ai-review-cancel-label">Cancel</span>
            </Button>
            <Button id="ai-review-save" variant="secondary" onClick={onSave} disabled={locked}>
              <span id="ai-review-save-label">Save but Don't Commit</span>
            </Button>
            <Button id="ai-review-commit" variant="primary" onClick={onCommit} disabled={locked} className="bg-emerald-600 hover:bg-emerald-500">
              <span id="ai-review-commit-label">{aiAction === "commit" ? "Committing…" : "Commit All"}</span>
            </Button>
            <Button id="ai-review-commit-push" variant="primary" onClick={onCommitAndPush} disabled={locked} className="bg-emerald-600 hover:bg-emerald-500">
              <span id="ai-review-commit-push-label">
                {aiAction === "refresh" ? "Refreshing…" : aiAction === "push" ? "Committing and pushing…" : "Commit All and Push"}
              </span>
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
