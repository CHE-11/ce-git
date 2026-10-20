import { Button } from "../Button";
import { Dialog } from "./Dialog";

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
      <p id={`${id}-copy`} className="text-sm wrap-break-word text-zinc-300">
        {copy}
      </p>
      <div id={`${id}-actions`} className="mt-4 flex justify-end gap-2">
        <Button id={`${id}-cancel`} variant="ghost" onClick={onClose}>
          <span id={`${id}-cancel-label`}>Cancel</span>
        </Button>
        <Button id={`${id}-confirm`} variant={confirmTone} onClick={onConfirm} onKeyDown={(event) => { if (event.key === "Enter") { onConfirm(); } }}>
          <span id={`${id}-confirm-label`}>{confirmLabel}</span>
          <kbd id={`${id}-confirm-shortcut`} className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
            Enter
          </kbd>
        </Button>
      </div>
    </Dialog>
  );
}
