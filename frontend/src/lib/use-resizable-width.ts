import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export type ResizableWidthOptions = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  maxFraction: number;
};

export type ResizableWidth = {
  width: number;
  dragging: boolean;
  min: number;
  max: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishDrag: () => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function limitFor(options: ResizableWidthOptions) {
  return Math.min(options.maxWidth, Math.max(options.minWidth, Math.floor(window.innerWidth * options.maxFraction)));
}

function clampFor(options: ResizableWidthOptions, width: number) {
  return Math.min(limitFor(options), Math.max(options.minWidth, Math.round(width)));
}

function readStored(options: ResizableWidthOptions) {
  try {
    const raw = localStorage.getItem(options.storageKey);
    if (raw === null) return clampFor(options, options.defaultWidth);
    const stored = Number(raw);
    if (Number.isFinite(stored)) return clampFor(options, stored);
  } catch {
    // Private mode or a blocked storage API leaves the default width in place.
  }
  return clampFor(options, options.defaultWidth);
}

function store(key: string, width: number) {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // Ignore quota and private-mode failures; the width still applies for this session.
  }
}

export function useResizableWidth(options: ResizableWidthOptions): ResizableWidth {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [width, setWidth] = useState(() => readStored(options));
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  const moved = useRef(false);
  widthRef.current = width;

  useEffect(() => {
    function onResize() {
      setWidth((current) => clampFor(optionsRef.current, current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const previousCursor = style.cursor;
    const previousUserSelect = style.userSelect;
    style.cursor = "col-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = previousCursor;
      style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  function commitWidth(next: number) {
    const clamped = clampFor(optionsRef.current, next);
    widthRef.current = clamped;
    setWidth(clamped);
    store(optionsRef.current.storageKey, clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, width: widthRef.current };
    moved.current = false;
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const next = clampFor(optionsRef.current, dragStart.current.width + event.clientX - dragStart.current.x);
    if (Math.abs(event.clientX - dragStart.current.x) > 2) moved.current = true;
    widthRef.current = next;
    setWidth(next);
  }

  function finishDrag() {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    store(optionsRef.current.storageKey, clampFor(optionsRef.current, widthRef.current));
  }

  function onDoubleClick() {
    if (moved.current) return;
    commitWidth(optionsRef.current.defaultWidth);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitWidth(widthRef.current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commitWidth(widthRef.current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitWidth(optionsRef.current.minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      commitWidth(limitFor(optionsRef.current));
    }
  }

  return {
    width,
    dragging,
    min: options.minWidth,
    max: limitFor(options),
    onPointerDown,
    onPointerMove,
    finishDrag,
    onDoubleClick,
    onKeyDown,
  };
}
