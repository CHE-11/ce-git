import { Button } from "../Button";
import { Dialog } from "../Dialog";

type ActionConfirmDialogProps = {
  id: string;
  title: string;
  copy: string;
  confirmLabel: string;
  confirmTone?: "primary" | "destructive";
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ActionConfirmDialog({
  id,
  title,
  copy,
  confirmLabel,
  confirmTone = "primary",
  open,
  onClose,
  onConfirm,
}: ActionConfirmDialogProps) {
  return (
    <Dialog id={id} title={title} open={open} onClose={onClose}>
      <p id={`${id}-copy`} className="text-sm break-words text-zinc-300">
        {copy}
      </p>
      <div id={`${id}-actions`} className="mt-4 flex justify-end gap-2">
        <Button id={`${id}-cancel`} variant="ghost" onClick={onClose}>
          <span id={`${id}-cancel-label`}>Cancel</span>
        </Button>
        <Button id={`${id}-confirm`} variant={confirmTone} onClick={onConfirm}>
          <span id={`${id}-confirm-label`}>{confirmLabel}</span>
        </Button>
      </div>
    </Dialog>
  );
}
