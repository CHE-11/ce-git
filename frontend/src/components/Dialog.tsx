import { useEffect, type ReactNode } from "react";

type DialogProps = {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ id, title, open, onClose, children }: DialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      id={`${id}-backdrop`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div id={`${id}-header`} className="border-b border-zinc-800 px-4 py-3">
          <h2 id={`${id}-title`} className="text-base font-semibold text-zinc-100">
            {title}
          </h2>
        </div>
        <div id={`${id}-body`} className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {children}
        </div>
      </div>
    </div>
  );
}
