import { Button } from "../Button";
import { Dialog } from "../Dialog";

type GitPushConfirmationDialogProps = {
  pushPaths: string[] | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function GitPushConfirmationDialog({ pushPaths, onClose, onConfirm }: GitPushConfirmationDialogProps) {
  return (
    <Dialog
      id="push-confirm-dialog"
      title="Push repositories"
      open={pushPaths !== null}
      onClose={onClose}
    >
      <p id="push-confirm-copy" className="text-sm text-zinc-300">
        Push {pushPaths?.length ?? 0} repositories to GitHub. Repos with nothing to push are skipped. A repository
        with no remote is created as a private GitHub repo when the GitHub CLI is signed in. Remotes that are not
        GitHub are skipped.
      </p>
      <div id="push-confirm-actions" className="mt-4 flex justify-end gap-2">
        <Button id="push-confirm-cancel" variant="ghost" onClick={onClose}>
          <span id="push-confirm-cancel-label">Cancel</span>
        </Button>
        <Button id="push-confirm-button" variant="primary" onClick={() => void onConfirm()}>
          <span id="push-confirm-button-label">Push</span>
        </Button>
      </div>
    </Dialog>
  );
}
