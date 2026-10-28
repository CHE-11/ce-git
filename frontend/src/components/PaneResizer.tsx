import { cn } from "../lib/cn";
import type { ResizableWidth } from "../lib/use-resizable-width";

type PaneResizerProps = {
  id: string;
  label: string;
  resizable: ResizableWidth;
};

export function PaneResizer({ id, label, resizable }: PaneResizerProps) {
  return (
    <div
      id={id}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={resizable.min}
      aria-valuemax={resizable.max}
      aria-valuenow={resizable.width}
      tabIndex={0}
      className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none"
      onPointerDown={resizable.onPointerDown}
      onPointerMove={resizable.onPointerMove}
      onPointerUp={resizable.finishDrag}
      onPointerCancel={resizable.finishDrag}
      onLostPointerCapture={resizable.finishDrag}
      onDoubleClick={resizable.onDoubleClick}
      onKeyDown={resizable.onKeyDown}
    >
      <span
        id={`${id}-line`}
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-500 opacity-0 transition-opacity",
          resizable.dragging && "opacity-100",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      />
    </div>
  );
}
