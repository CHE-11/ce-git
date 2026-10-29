import { FolderSearch } from "lucide-react";
import type { ReactNode } from "react";
import {
  COLOR_MODE_OPTIONS,
  resolveMode,
  THEME_STYLESHEET_NAME,
  THEMES,
  type ColorMode,
  type ThemeId,
} from "../../../lib/appearance";
import { cn } from "../../../lib/cn";
import { editorGroups, type EditorId } from "../../../lib/editors";
import { fileManagerLabel } from "../../../lib/changes";
import type { TreeStyle } from "../../../lib/tree-style";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../../../lib/zoom";
import { Button } from "../../Button";

type AppSettingsTabProps = {
  busy: boolean;
  exePath: string;
  folder: string;
  zoom: number;
  theme: ThemeId;
  colorMode: ColorMode;
  toolbarLabels: boolean;
  treeStyle: TreeStyle;
  defaultEditor: EditorId;
  menuEditors: readonly EditorId[];
  warning: string | null;
  error: string | null;
  onFolderChange: (folder: string) => void;
  onFolderCommit: () => void;
  onZoomChange: (zoom: number) => void;
  onThemeChange: (theme: ThemeId) => void;
  onColorModeChange: (colorMode: ColorMode) => void;
  onToolbarLabelsChange: (toolbarLabels: boolean) => void;
  onTreeStyleChange: (patch: Partial<TreeStyle>) => void;
  onDefaultEditorChange: (editor: EditorId) => void;
  onMenuEditorChange: (editor: EditorId, shown: boolean) => void;
  onBrowse: () => void;
  onClearFolder: () => void;
  onRevealExe: () => void;
  onSubmit: () => void;
};

export function AppSettingsTab({
  busy,
  exePath,
  folder,
  zoom,
  theme,
  colorMode,
  toolbarLabels,
  treeStyle,
  defaultEditor,
  menuEditors,
  warning,
  error,
  onFolderChange,
  onFolderCommit,
  onZoomChange,
  onThemeChange,
  onColorModeChange,
  onToolbarLabelsChange,
  onTreeStyleChange,
  onDefaultEditorChange,
  onMenuEditorChange,
  onBrowse,
  onClearFolder,
  onRevealExe,
  onSubmit,
}: AppSettingsTabProps) {
  const settingsFile = settingsFilePath(folder);
  const themeStylesheet = themeStylesheetPath(folder);
  const revealLabel = fileManagerLabel();
  const groups = editorGroups();

  return (
    <>
      <form
        id="settings-panel-app"
        role="tabpanel"
        aria-labelledby="settings-tab-app"
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <p id="app-settings-intro" className="text-sm leading-5 text-zinc-400">
          Save stores appearance, editors, and the settings folder. A folder keeps them in ce-git.json, including on a
          shared drive. The OpenAI key stays in this computer's credential manager, and Git settings stay in Git.
        </p>

        <section id="app-settings-application" className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <span id="app-settings-exe-label" className="shrink-0 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Application
          </span>
          <p id="app-settings-exe" className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200 select-all" title={exePath}>
            {exePath || "Looking up this application…"}
          </p>
          <Button
            id="app-settings-exe-reveal"
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            title={revealLabel}
            disabled={busy || exePath.length === 0}
            onClick={onRevealExe}
          >
            <FolderSearch id="app-settings-exe-reveal-icon" className="size-3.5" aria-hidden="true" />
            <span id="app-settings-exe-reveal-label">{revealLabel}</span>
          </Button>
        </section>

        <SettingsSection
          id="app-settings-location"
          title="Settings folder"
          hint="Leave this blank to keep a copy on this computer. Clear the folder to stop using a shared file without deleting it."
        >
          <label id="app-settings-folder-label" htmlFor="app-settings-folder-input" className="mb-1 block text-xs font-medium text-zinc-400">
            Folder
          </label>
          <div id="app-settings-folder-row" className="flex gap-2">
            <input
              id="app-settings-folder-input"
              value={folder}
              onChange={(event) => onFolderChange(event.target.value)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof HTMLElement && (next.id === "app-settings-browse" || next.id === "app-settings-clear")) {
                  return;
                }
                onFolderCommit();
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder="\\\\server\\share\\ce-git"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <Button id="app-settings-browse" type="button" onClick={onBrowse} disabled={busy}>
              <span id="app-settings-browse-label">Browse</span>
            </Button>
            <Button id="app-settings-clear" type="button" variant="ghost" onClick={onClearFolder} disabled={busy || folder.trim().length === 0}>
              <span id="app-settings-clear-label">Clear</span>
            </Button>
          </div>
          <p id="app-settings-folder-file" className="mt-2 truncate font-mono text-xs text-zinc-500" title={settingsFile || undefined}>
            {settingsFile ? `Settings file: ${settingsFile}` : "Settings file: on this computer"}
          </p>
        </SettingsSection>

        <SettingsSection
          id="app-settings-editors"
          title="Editors"
          hint="Choose the default used by Open in editor. Turn on Menu to list that editor in the repository and changes right-click menus."
        >
          <div id="app-settings-editor-groups" role="radiogroup" aria-labelledby="app-settings-editors-heading" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <div id={`app-settings-editor-group-${group.id}`} key={group.id} className="min-w-0">
                <h4 id={`app-settings-editor-group-${group.id}-label`} className="mb-1.5 text-xs font-medium text-zinc-400">
                  {group.label}
                </h4>
                <div id={`app-settings-editor-group-${group.id}-list`} className="flex flex-col gap-1">
                  {group.editors.map((editor) => {
                    const selected = defaultEditor === editor.id;
                    const shown = menuEditors.includes(editor.id);
                    return (
                      <div
                        id={`app-settings-editor-${editor.id}`}
                        key={editor.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2 py-1",
                          selected ? "border-sky-600 bg-sky-950/30" : "border-zinc-800 bg-zinc-950",
                        )}
                      >
                        <input
                          id={`app-settings-editor-${editor.id}-default`}
                          type="radio"
                          name="app-settings-default-editor"
                          checked={selected}
                          disabled={busy}
                          onChange={() => onDefaultEditorChange(editor.id)}
                          className="size-3.5 shrink-0 accent-sky-500 disabled:opacity-50"
                        />
                        <label
                          id={`app-settings-editor-${editor.id}-name`}
                          htmlFor={`app-settings-editor-${editor.id}-default`}
                          className="min-w-0 flex-1 truncate text-sm text-zinc-100"
                        >
                          {editor.label}
                        </label>
                        <label
                          id={`app-settings-editor-${editor.id}-menu-label`}
                          htmlFor={`app-settings-editor-${editor.id}-menu`}
                          className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400"
                        >
                          <input
                            id={`app-settings-editor-${editor.id}-menu`}
                            type="checkbox"
                            checked={shown}
                            disabled={busy}
                            onChange={(event) => onMenuEditorChange(editor.id, event.target.checked)}
                            className="size-3.5 accent-sky-500 disabled:opacity-50"
                          />
                          <span id={`app-settings-editor-${editor.id}-menu-text`}>Menu</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          id="app-settings-appearance"
          title="Appearance"
          hint="Text size, color mode, and toolbar labels apply as you change them. Save keeps the choice."
        >
          <label id="app-settings-zoom-label" htmlFor="app-settings-zoom" className="mb-1 block text-xs font-medium text-zinc-400">
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

          <div id="app-settings-mode-block" className="mt-4">
            <label id="app-settings-mode-label" className="mb-1 block text-xs font-medium text-zinc-400">
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
          </div>

          <label id="app-settings-toolbar-labels" className="mt-4 flex items-center gap-2 text-sm text-zinc-200">
            <input
              id="app-settings-toolbar-labels-input"
              type="checkbox"
              checked={toolbarLabels}
              disabled={busy}
              onChange={(event) => onToolbarLabelsChange(event.target.checked)}
              className="size-4 accent-sky-500 disabled:opacity-50"
            />
            <span id="app-settings-toolbar-labels-text">Show names under toolbar buttons</span>
          </label>

          <div id="app-settings-theme-block" className="mt-4">
            <label id="app-settings-theme-label" className="mb-1 block text-xs font-medium text-zinc-400">
              Theme
            </label>
            <div id="app-settings-themes" className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-labelledby="app-settings-theme-label">
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
                      "flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm disabled:opacity-50",
                      selected
                        ? "border-sky-500 bg-zinc-800 text-zinc-100"
                        : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
                    )}
                  >
                    <span
                      id={`app-settings-theme-${option.id}-swatch`}
                      className="relative h-7 w-10 shrink-0 overflow-hidden rounded border border-zinc-600"
                      style={{ background: swatch.background }}
                      aria-hidden="true"
                    >
                      <span
                        id={`app-settings-theme-${option.id}-swatch-surface`}
                        className="absolute right-1 bottom-1 h-2.5 w-4 rounded-sm"
                        style={{ background: swatch.surface }}
                      />
                      <span
                        id={`app-settings-theme-${option.id}-swatch-accent`}
                        className="absolute top-1 left-1 size-1.5 rounded-full"
                        style={{ background: swatch.accent }}
                      />
                      <span
                        id={`app-settings-theme-${option.id}-swatch-text`}
                        className="absolute top-0.5 right-1 text-[8px] leading-none font-semibold"
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
            <p id="app-settings-theme-css-hint" className="mt-2 text-xs leading-5 text-zinc-500">
              {themeStylesheet
                ? `${themeStylesheet} is created when it is missing. The sample rules are commented out. ce-git reads the file when it starts and when this window is focused.`
                : `Choose a settings folder and ce-git will add ${THEME_STYLESHEET_NAME} there, with the color overrides commented out.`}
            </p>
          </div>
        </SettingsSection>

        <SettingsSection
          id="app-settings-tree"
          title="Repository tree"
          hint="Color a top-level folder and everything inside it. Background and name color cannot both be on. Save keeps the choice."
        >
          <TreeStyleToggle
            id="app-settings-folder-background"
            label="Color folder backgrounds"
            checked={treeStyle.folderColorBackground}
            disabled={busy}
            onChange={(checked) => onTreeStyleChange({ folderColorBackground: checked })}
          />
          <TreeStyleToggle
            id="app-settings-folder-background-unique"
            label="Different color for each top-level folder"
            checked={treeStyle.folderColorBackgroundUnique}
            disabled={busy || !treeStyle.folderColorBackground}
            nested
            onChange={(checked) => onTreeStyleChange({ folderColorBackgroundUnique: checked })}
          />
          <TreeStyleToggle
            id="app-settings-folder-font"
            label="Color folder names"
            checked={treeStyle.folderFontColor}
            disabled={busy}
            onChange={(checked) => onTreeStyleChange({ folderFontColor: checked })}
          />
          <TreeStyleToggle
            id="app-settings-folder-font-unique"
            label="Different color for each top-level folder"
            checked={treeStyle.folderFontColorUnique}
            disabled={busy || !treeStyle.folderFontColor}
            nested
            onChange={(checked) => onTreeStyleChange({ folderFontColorUnique: checked })}
          />
          <TreeStyleToggle
            id="app-settings-folder-indicator"
            label="Show a line beside items in a folder"
            checked={treeStyle.folderIndicator}
            disabled={busy}
            onChange={(checked) => onTreeStyleChange({ folderIndicator: checked })}
          />
        </SettingsSection>
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

function TreeStyleToggle({
  id,
  label,
  checked,
  disabled,
  nested = false,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  nested?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      id={id}
      className={cn(
        "flex items-center gap-2 text-sm first:mt-0",
        nested ? "mt-1.5 pl-6" : "mt-3",
        disabled ? "text-zinc-500" : "text-zinc-200",
      )}
    >
      <input
        id={`${id}-input`}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-sky-500 disabled:opacity-50"
      />
      <span id={`${id}-text`}>{label}</span>
    </label>
  );
}

function SettingsSection({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3">
      <h3 id={`${id}-heading`} className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
        {title}
      </h3>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-zinc-500">
          {hint}
        </p>
      ) : null}
      <div id={`${id}-body`} className="mt-3">
        {children}
      </div>
    </section>
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
