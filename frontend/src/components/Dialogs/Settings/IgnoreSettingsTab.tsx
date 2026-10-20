import { folderIgnoreError } from "../../../lib/tree";

type IgnoreSettingsTabProps = {
  busy: boolean;
  pattern: string;
  error: string | null;
  onPatternChange: (pattern: string) => void;
  onSubmit: () => void;
};

export function IgnoreSettingsTab({ busy, pattern, error, onPatternChange, onSubmit }: IgnoreSettingsTabProps) {
  const patternError = folderIgnoreError(pattern);
  const shownError = error ?? patternError;

  return (
    <form
      id="settings-panel-ignore"
      role="tabpanel"
      aria-labelledby="settings-tab-ignore"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p id="ignore-settings-intro" className="mt-4 text-sm text-zinc-300">
        Hide folders in the repository list. Each line is a regular expression, matched without regard to letter case
        against the folder name and its full path. A match hides that folder and everything inside it.
      </p>
      <label id="ignore-settings-pattern-label" htmlFor="ignore-settings-pattern" className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Folder patterns
      </label>
      <textarea
        id="ignore-settings-pattern"
        value={pattern}
        disabled={busy}
        spellCheck={false}
        rows={8}
        placeholder={"node_modules\n(^|[\\\\/])dist$\narchive"}
        onChange={(event) => onPatternChange(event.target.value)}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50"
      />
      <p id="ignore-settings-hint" className="mt-1 text-xs text-zinc-500">
        Leave this blank to show every folder. Use ^ and $ when a pattern should match the whole name, for example ^temp$.
      </p>
      {shownError ? (
        <p id="ignore-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {shownError}
        </p>
      ) : null}
    </form>
  );
}
