import type { AiCommitDraft } from "../../../../types/git";
import { domId } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

type AiReviewDialogProps = {
  open: boolean;
  drafts: AiCommitDraft[];
  generating: boolean;
  busy: boolean;
  onClose: () => void;
  onChange: (path: string, patch: { message?: string; description?: string }) => void;
  onToggle: (path: string) => void;
  onCommit: () => void;
};

export function AiReviewDialog({
  open,
  drafts,
  generating,
  busy,
  onClose,
  onChange,
  onToggle,
  onCommit,
}: AiReviewDialogProps) {
  return (
    <Dialog id="ai-review-dialog" title="Review AI commit messages" open={open} onClose={onClose}>
      <p id="ai-review-note" className="mb-3 text-sm text-zinc-400">
        {generating ? "Generating messages…" : "Edit any message, then commit the selected repositories."}
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
      <div id="ai-review-actions" className="mt-4 flex justify-end gap-2">
        <Button id="ai-review-cancel" variant="ghost" onClick={onClose} disabled={busy}>
          <span id="ai-review-cancel-label">Cancel</span>
        </Button>
        <Button id="ai-review-commit" variant="primary" onClick={onCommit} disabled={busy || generating} className="bg-emerald-600 hover:bg-emerald-500">
          <span id="ai-review-commit-label">{busy ? "Committing…" : "Commit selected"}</span>
        </Button>
      </div>
    </Dialog>
  );
}
