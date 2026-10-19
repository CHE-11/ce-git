import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import type { AiPrompts, AppSettings } from "../../../../types/git";
import { withDefaultPrompts } from "../../lib/commit-prompts";
import { appSettings, saveAppSettings } from "../../lib/git-client";
import { messageOf } from "../../lib/tree";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, readZoom } from "../../lib/zoom";
import { Button } from "../Button";
import { Dialog } from "../Dialog";

type AppSettingsDialogProps = {
  selectedPrompt: number;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
};

export function AppSettingsDialog({ selectedPrompt, onClose, onSaved }: AppSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folder, setFolder] = useState("");
  const [zoom, setZoom] = useState(readZoom);
  const [prompts, setPrompts] = useState<AiPrompts>(withDefaultPrompts(undefined));
  const [warning, setWarning] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await appSettings();
        if (cancelled) {
          return;
        }
        setFolder(settings.settingsFolder);
        setWarning(settings.warning);
        setPrompts(withDefaultPrompts(settings.prompts));
        if (settings.shared) {
          setZoom(clampDialogZoom(settings.fontZoom));
        }
      } catch (caught) {
        if (!cancelled) {
          setLocalError(messageOf(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestClose = () => {
    if (saving) {
      return;
    }
    onClose();
  };

  const browse = async () => {
    setLocalError(null);
    try {
      const picked = await openFolder({
        directory: true,
        multiple: false,
        title: "Choose the settings folder",
        defaultPath: folder.trim() || undefined,
      });
      if (typeof picked === "string") {
        setFolder(picked);
        setWarning(null);
      }
    } catch (caught) {
      setLocalError(messageOf(caught));
    }
  };

  const save = async () => {
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await saveAppSettings({
        settingsFolder: folder.trim(),
        fontZoom: zoom,
        selectedPrompt,
        prompts,
      });
      onSaved(saved);
      onClose();
    } catch (caught) {
      setLocalError(messageOf(caught));
      setSaving(false);
    }
  };

  const settingsFile = settingsFilePath(folder);

  return (
    <Dialog id="app-settings-dialog" title="App settings" open onClose={requestClose}>
      {loading ? (
        <p id="app-settings-loading" className="text-sm text-zinc-400">
          Loading app settings…
        </p>
      ) : (
        <form
          id="app-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p id="app-settings-intro" className="text-sm text-zinc-300">
            Point ce-git at one folder, including a shared drive. Workspace folders, hidden repositories, text size,
            and AI model, thinking, and prompts are saved there in ce-git.json. The OpenAI key stays in this computer's
            credential manager, and Git settings stay in Git.
          </p>

          <section id="app-settings-location" className="mt-4">
            <h3 id="app-settings-location-heading" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Settings folder
            </h3>
            <label id="app-settings-folder-label" htmlFor="app-settings-folder-input" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Folder
            </label>
            <div id="app-settings-folder-row" className="flex gap-2">
              <input
                id="app-settings-folder-input"
                value={folder}
                onChange={(event) => {
                  setFolder(event.target.value);
                  setWarning(null);
                  setLocalError(null);
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                placeholder="\\\\server\\share\\ce-git"
                className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50"
              />
              <Button id="app-settings-browse" onClick={() => void browse()} disabled={saving}>
                <span id="app-settings-browse-label">Browse</span>
              </Button>
              <Button
                id="app-settings-clear"
                variant="ghost"
                onClick={() => {
                  setFolder("");
                  setWarning(null);
                  setLocalError(null);
                }}
                disabled={saving || folder.trim().length === 0}
              >
                <span id="app-settings-clear-label">Clear</span>
              </Button>
            </div>
            <p id="app-settings-folder-hint" className="mt-1 text-xs text-zinc-500">
              {settingsFile
                ? `Settings file: ${settingsFile}. If that file already exists, ce-git uses it. Clear the folder to keep a copy on this computer and leave the shared file in place.`
                : "Leave this blank to keep settings on this computer."}
            </p>
          </section>

          <section id="app-settings-appearance" className="mt-5">
            <h3 id="app-settings-appearance-heading" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Appearance
            </h3>
            <label id="app-settings-zoom-label" htmlFor="app-settings-zoom" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Text size
            </label>
            <div id="app-settings-zoom-row" className="flex items-center gap-3">
              <input
                id="app-settings-zoom"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={zoom}
                disabled={saving}
                aria-valuemin={MIN_ZOOM}
                aria-valuemax={MAX_ZOOM}
                aria-valuenow={zoom}
                onChange={(event) => setZoom(clampDialogZoom(Number(event.target.value)))}
                className="w-full accent-sky-500 disabled:opacity-50"
              />
              <span id="app-settings-zoom-value" className="w-12 shrink-0 text-right text-sm text-zinc-200 tabular-nums">
                {zoom}%
              </span>
            </div>
            <p id="app-settings-zoom-hint" className="mt-1 text-xs text-zinc-500">
              Ctrl plus and Ctrl minus change this while you work. The status bar shows the current size.
            </p>
          </section>

        </form>
      )}

      {warning ? (
        <p id="app-settings-warning" className="mt-3 text-sm text-amber-200" role="status">
          {warning}
        </p>
      ) : null}
      {localError ? (
        <p id="app-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {localError}
        </p>
      ) : null}

      <div id="app-settings-actions" className="mt-4 flex justify-end gap-2">
        <Button id="app-settings-cancel" variant="ghost" onClick={requestClose} disabled={saving}>
          <span id="app-settings-cancel-label">Cancel</span>
        </Button>
        {!loading ? (
          <Button id="app-settings-save" type="submit" form="app-settings-form" variant="primary" disabled={saving}>
            <span id="app-settings-save-label">{saving ? "Saving…" : "Save"}</span>
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}

function clampDialogZoom(value: number) {
  if (!Number.isFinite(value)) {
    return readZoom();
  }
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

function settingsFilePath(folder: string) {
  const trimmed = folder.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  return `${trimmed}${separator}ce-git.json`;
}
