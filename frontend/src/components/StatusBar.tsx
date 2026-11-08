import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { appVersion } from "../lib/git-client";
import { useFontZoom } from "../lib/zoom";
import { baseName } from "../lib/tree";

type StatusBarProps = {
  rootPaths: string[];
  branch: string | null;
  discovering: boolean;
  gitReady: boolean;
  updateVersion: string | null;
  onUpdate: () => void;
  onBranch?: () => void;
  branchDisabled?: boolean;
};

function Divider({ id }: { id: string }) {
  return <span id={id} className="h-3 w-px shrink-0 bg-zinc-700" aria-hidden="true" />;
}

export function StatusBar({ rootPaths, branch, discovering, gitReady, updateVersion, onUpdate, onBranch, branchDisabled = false }: StatusBarProps) {
  const zoom = useFontZoom();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <footer
      id="status-bar"
      className="flex h-6 shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-400 select-none"
    >
      <div id="status-bar-stats" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {updateVersion ? (
          <>
            <button
              id="status-update"
              type="button"
              title={version ? `ce-git ${version}. Update to v${updateVersion}` : `Update to v${updateVersion}`}
              onClick={onUpdate}
              className="shrink-0 rounded px-1 text-sky-300 hover:bg-zinc-800 hover:text-sky-200"
            >
              <span id="status-update-label">Update to v{updateVersion}</span>
            </button>
            <Divider id="status-sep-version" />
          </>
        ) : version ? (
          <>
            <span id="status-version" className="shrink-0 text-zinc-500 tabular-nums" title={`ce-git ${version}`}>
              v{version}
            </span>
            <Divider id="status-sep-version" />
          </>
        ) : null}
        <span
          id="status-folder"
          className="min-w-0 truncate text-zinc-300"
          title={rootPaths.length > 0 ? rootPaths.join("\n") : "No folder open"}
        >
          {rootPaths.length === 0
            ? "No folder"
            : rootPaths.length === 1
              ? baseName(rootPaths[0])
              : rootPaths.map((path) => baseName(path)).join(", ")}
        </span>
        {branch ? (
          <>
            <Divider id="status-sep-branch" />
            {onBranch ? (
              <button
                id="status-branch"
                type="button"
                title="Switch branch or create a new one"
                aria-haspopup="dialog"
                disabled={branchDisabled}
                onClick={onBranch}
                className="shrink-0 truncate border-0 bg-transparent p-0 text-xs text-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {branch}
              </button>
            ) : (
              <span id="status-branch" className="shrink-0 truncate text-sky-300" title={branch}>
                {branch}
              </span>
            )}
          </>
        ) : null}
        {discovering ? (
          <>
            <Divider id="status-sep-scanning" />
            <span id="status-scanning" className="shrink-0 text-zinc-400">
              Scanning…
            </span>
          </>
        ) : null}
        {gitReady ? null : (
          <>
            <Divider id="status-sep-git" />
            <span id="status-git" className="shrink-0 text-amber-300">
              Git missing
            </span>
          </>
        )}
      </div>

      <div id="status-zoom" className="flex shrink-0 items-center">
        <button
          id="status-zoom-out"
          type="button"
          title="Smaller font (Ctrl+-)"
          aria-label="Smaller font"
          disabled={zoom.atMin}
          onClick={zoom.decrease}
          className="inline-flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus id="status-zoom-out-icon" className="size-3" />
        </button>
        <button
          id="status-zoom-reset"
          type="button"
          title="Reset font size (Ctrl+0)"
          aria-label={`Font size ${zoom.zoom} percent. Reset to 100 percent.`}
          onClick={zoom.reset}
          className="inline-flex h-5 min-w-11 items-center justify-center rounded px-1 text-zinc-300 tabular-nums hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span id="status-zoom-label">{zoom.zoom}%</span>
        </button>
        <button
          id="status-zoom-in"
          type="button"
          title="Larger font (Ctrl++)"
          aria-label="Larger font"
          disabled={zoom.atMax}
          onClick={zoom.increase}
          className="inline-flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus id="status-zoom-in-icon" className="size-3" />
        </button>
      </div>
    </footer>
  );
}
