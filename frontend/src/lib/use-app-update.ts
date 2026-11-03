import { relaunch } from "@tauri-apps/plugin-process";
import { LazyStore } from "@tauri-apps/plugin-store";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { appRelease, appVersion } from "./git-client";
import { messageOf } from "./tree";

const settingsStore = new LazyStore("settings.json");

export type UpdateDialogMode = "update" | "downloading" | "notes" | "current" | "error";

function releaseVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

async function readSeenRelease() {
  const value = await settingsStore.get<string>("seenRelease");
  return typeof value === "string" && value.trim() ? releaseVersion(value) : null;
}

async function writeSeenRelease(version: string) {
  await settingsStore.set("seenRelease", releaseVersion(version));
  await settingsStore.save();
}

export function useAppUpdate() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<UpdateDialogMode>("update");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const notesVersionRef = useRef<string | null>(null);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);

  const closeUpdate = useCallback(() => {
    const pending = updateRef.current;
    updateRef.current = null;
    if (pending) {
      void pending.close();
    }
  }, []);

  const showRelease = useCallback((next: Update) => {
    closeUpdate();
    updateRef.current = next;
    notesVersionRef.current = null;
    setAvailableVersion(releaseVersion(next.version));
    setVersion(releaseVersion(next.version));
    setNotes(next.body?.trim() ?? "");
    setError(null);
    setProgress(null);
    setMode("update");
    setOpen(true);
  }, [closeUpdate]);

  const showWhatsNew = useCallback(async (current: string) => {
    const seen = await readSeenRelease();
    if (seen === null) {
      await writeSeenRelease(current);
      return;
    }
    if (seen === current) {
      return;
    }
    const release = await appRelease();
    if (releaseVersion(release.version) !== current) {
      return;
    }
    closeUpdate();
    notesVersionRef.current = current;
    setVersion(current);
    setNotes(release.notes.trim());
    setError(null);
    setProgress(null);
    setMode("notes");
    setOpen(true);
  }, [closeUpdate]);

  const checkForUpdate = useCallback(async (manual: boolean) => {
    if (import.meta.env.DEV) {
      if (manual) {
        closeUpdate();
        notesVersionRef.current = null;
        setError("Updates run from an installed build.");
        setMode("error");
        setOpen(true);
      }
      return;
    }
    if (checkingRef.current || installingRef.current) {
      return;
    }
    checkingRef.current = true;
    try {
      const next = await check();
      if (next) {
        if ((await readSeenRelease()) === null) {
          await writeSeenRelease(releaseVersion(next.currentVersion));
        }
        showRelease(next);
        return;
      }
      setAvailableVersion(null);
      const current = releaseVersion(await appVersion());
      if (manual) {
        closeUpdate();
        notesVersionRef.current = null;
        setVersion(current);
        setError(null);
        setMode("current");
        setOpen(true);
        return;
      }
      await showWhatsNew(current);
    } catch (caught) {
      if (manual) {
        closeUpdate();
        notesVersionRef.current = null;
        setError(messageOf(caught));
        setMode("error");
        setOpen(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [closeUpdate, showRelease, showWhatsNew]);

  useEffect(() => {
    void checkForUpdate(false);
  }, [checkForUpdate]);

  const install = useCallback(async () => {
    const pending = updateRef.current;
    if (!pending || installingRef.current) {
      return;
    }
    installingRef.current = true;
    setMode("downloading");
    setError(null);
    setProgress(null);
    let downloaded = 0;
    let total = 0;
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(total > 0 ? 0 : null);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
          }
        }
      }, { restartAfterInstall: true });
      await relaunch();
    } catch (caught) {
      installingRef.current = false;
      setError(messageOf(caught));
      setMode("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    if (installingRef.current) {
      return;
    }
    const seen = notesVersionRef.current;
    if (mode === "notes" && seen) {
      notesVersionRef.current = null;
      void writeSeenRelease(seen);
    }
    setOpen(false);
  }, [mode]);

  const showPending = useCallback(() => {
    if (installingRef.current) {
      setOpen(true);
      return;
    }
    if (availableVersion && updateRef.current) {
      setMode("update");
      setError(null);
      setOpen(true);
    }
  }, [availableVersion]);

  return {
    open,
    mode,
    version,
    notes,
    progress,
    error,
    availableVersion,
    installing: mode === "downloading",
    checkForUpdate: () => checkForUpdate(true),
    install,
    dismiss,
    showPending,
  };
}
