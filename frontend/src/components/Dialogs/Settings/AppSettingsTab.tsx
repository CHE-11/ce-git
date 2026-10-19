import {
  COLOR_MODE_OPTIONS,
  resolveMode,
  THEME_STYLESHEET_NAME,
  THEMES,
  type ColorMode,
  type ThemeId,
} from "../../../lib/appearance";
import { cn } from "../../../lib/cn";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../../../lib/zoom";
import { Button } from "../../Button";

type AppSettingsTabProps = {
  busy: boolean;
  folder: string;
  zoom: number;
  theme: ThemeId;
  colorMode: ColorMode;
  warning: string | null;
  error: string | null;
  onFolderChange: (folder: string) => void;
  onZoomChange: (zoom: number) => void;
  onThemeChange: (theme: ThemeId) => void;
  onColorModeChange: (colorMode: ColorMode) => void;
  onBrowse: () => void;
  onClearFolder: () => void;
  onSubmit: () => void;
};

export function AppSettingsTab({
  busy,
  folder,
  zoom,
  theme,
  colorMode,
  warning,
  error,
  onFolderChange,
  onZoomChange,
  onThemeChange,
  onColorModeChange,
  onBrowse,
  onClearFolder,
  onSubmit,
}: AppSettingsTabProps) {
  const settingsFile = settingsFilePath(folder);
  const themeStylesheet = themeStylesheetPath(folder);

  return (
    <>
      <form
        id="settings-panel-app"
        role="tabpanel"
        aria-labelledby="settings-tab-app"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <p id="app-settings-intro" className="mt-4 text-sm text-zinc-300">
          Point ce-git at one folder, including a shared drive. Workspace folders, hidden repositories, text size,
          theme, color mode, and AI model, thinking, and prompts are saved there in ce-git.json. ce-git adds{" "}
          {THEME_STYLESHEET_NAME} in that folder when it is missing, with the color overrides commented out, and loads
          the file on top of the theme. The OpenAI key stays in this computer's credential manager,
          and Git settings stay in Git.
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
              onChange={(event) => onFolderChange(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder="\\\\server\\share\\ce-git"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <Button id="app-settings-browse" onClick={onBrowse} disabled={busy}>
              <span id="app-settings-browse-label">Browse</span>
            </Button>
            <Button id="app-settings-clear" variant="ghost" onClick={onClearFolder} disabled={busy || folder.trim().length === 0}>
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
              disabled={busy}
              aria-valuemin={MIN_ZOOM}
              aria-valuemax={MAX_ZOOM}
              aria-valuenow={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="w-full accent-sky-500 disabled:opacity-50"
            />
            <span id="app-settings-zoom-value" className="w-12 shrink-0 text-right text-sm text-zinc-200 tabular-nums">
              {zoom}%
            </span>
          </div>
          <p id="app-settings-zoom-hint" className="mt-1 text-xs text-zinc-500">
            Ctrl plus and Ctrl minus change this while you work. The status bar shows the current size.
          </p>

          <label id="app-settings-theme-label" className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Theme
          </label>
          <div id="app-settings-themes" className="grid grid-cols-2 gap-2" role="group" aria-labelledby="app-settings-theme-label">
            {THEMES.map((option) => {
              const selected = theme === option.id;
              const swatch = option.swatch[resolveMode(colorMode)];
              return (
                <button
                  id={`app-settings-theme-${option.id}`}
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => onThemeChange(option.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50",
                    selected
                      ? "border-sky-500 bg-zinc-800 text-zinc-100"
                      : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
                  )}
                >
                  <span
                    id={`app-settings-theme-${option.id}-swatch`}
                    className="relative h-8 w-12 shrink-0 overflow-hidden rounded border border-zinc-600"
                    style={{ background: swatch.background }}
                    aria-hidden="true"
                  >
                    <span
                      id={`app-settings-theme-${option.id}-swatch-surface`}
                      className="absolute right-1 bottom-1 h-3 w-5 rounded-sm"
                      style={{ background: swatch.surface }}
                    />
                    <span
                      id={`app-settings-theme-${option.id}-swatch-accent`}
                      className="absolute top-1 left-1 size-2 rounded-full"
                      style={{ background: swatch.accent }}
                    />
                    <span
                      id={`app-settings-theme-${option.id}-swatch-text`}
                      className="absolute top-1 right-1 text-[8px] leading-none font-semibold"
                      style={{ color: swatch.text }}
                    >
                      A
                    </span>
                  </span>
                  <span id={`app-settings-theme-${option.id}-label`}>{option.label}</span>
                </button>
              );
            })}
          </div>

          <label id="app-settings-mode-label" className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Color mode
          </label>
          <div id="app-settings-modes" className="flex overflow-hidden rounded-md border border-zinc-700" role="group" aria-labelledby="app-settings-mode-label">
            {COLOR_MODE_OPTIONS.map((option) => {
              const selected = colorMode === option.id;
              return (
                <button
                  id={`app-settings-mode-${option.id}`}
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => onColorModeChange(option.id)}
                  className={cn(
                    "h-8 flex-1 text-sm disabled:opacity-50",
                    selected ? "bg-sky-600 text-white" : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
                  )}
                >
                  <span id={`app-settings-mode-${option.id}-label`}>{option.label}</span>
                </button>
              );
            })}
          </div>
          <p id="app-settings-mode-hint" className="mt-1 text-xs text-zinc-500">
            Match system follows this computer's light or dark setting.
          </p>
          <p id="app-settings-theme-css-hint" className="mt-3 text-xs text-zinc-500">
            {themeStylesheet
              ? `${themeStylesheet} is created when it is missing. The sample rules are commented out. ce-git reads the file when it starts and when this window is focused.`
              : `Choose a settings folder and ce-git will add ${THEME_STYLESHEET_NAME} there, with the color overrides commented out.`}
          </p>
        </section>
      </form>
      {warning ? (
        <p id="app-settings-warning" className="mt-3 text-sm text-amber-200" role="status">
          {warning}
        </p>
      ) : null}
      {error ? (
        <p id="app-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function settingsFilePath(folder: string) {
  return settingsChildPath(folder, "ce-git.json");
}

function themeStylesheetPath(folder: string) {
  return settingsChildPath(folder, THEME_STYLESHEET_NAME);
}

function settingsChildPath(folder: string, name: string) {
  const trimmed = folder.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  return `${trimmed}${separator}${name}`;
}
