import { useCallback, useEffect, useRef, useState } from "react";

export const ZOOM_KEY = "ce-git.font-zoom";
export const ZOOM_EVENT = "ce-git-zoom";
export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 60;
export const MAX_ZOOM = 160;
export const ZOOM_STEP = 10;

const BASE_FONT_PX = 16;

type ZoomChange = number | "reset";

export function clampZoom(value: number) {
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

export function readZoom() {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw === null) {
      return DEFAULT_ZOOM;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return DEFAULT_ZOOM;
    }
    return clampZoom(value);
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function applyZoom(percent: number) {
  document.documentElement.style.fontSize = `${(BASE_FONT_PX * percent) / 100}px`;
}

function rememberZoom(percent: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(percent));
  } catch {
    // Ignore quota and private-mode failures; the size still applies for this session.
  }
  window.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: percent }));
}

export function publishZoom(percent: number) {
  const next = clampZoom(percent);
  applyZoom(next);
  rememberZoom(next);
  return next;
}

function zoomChangeForKey(key: string): ZoomChange | null {
  if (key === "=" || key === "+" || key === "Add") {
    return ZOOM_STEP;
  }
  if (key === "-" || key === "_" || key === "Subtract") {
    return -ZOOM_STEP;
  }
  if (key === "0") {
    return "reset";
  }
  return null;
}

export function useFontZoom() {
  const [zoom, setZoom] = useState(readZoom);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const changeZoom = useCallback((change: ZoomChange) => {
    const next = change === "reset" ? DEFAULT_ZOOM : clampZoom(zoomRef.current + change);
    zoomRef.current = next;
    applyZoom(next);
    rememberZoom(next);
    setZoom(next);
  }, []);

  useEffect(() => {
    function onZoom(event: Event) {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail !== "number" || !Number.isFinite(detail)) {
        return;
      }
      setZoom(clampZoom(detail));
    }

    window.addEventListener(ZOOM_EVENT, onZoom);
    return () => window.removeEventListener(ZOOM_EVENT, onZoom);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }
      const change = zoomChangeForKey(event.key);
      if (change === null) {
        return;
      }
      event.preventDefault();
      changeZoom(change);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeZoom]);

  return {
    zoom,
    atMin: zoom <= MIN_ZOOM,
    atMax: zoom >= MAX_ZOOM,
    decrease: () => changeZoom(-ZOOM_STEP),
    increase: () => changeZoom(ZOOM_STEP),
    reset: () => changeZoom("reset"),
  };
}
