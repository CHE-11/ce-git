import { cn } from "../lib/cn";

type DiffViewProps = {
  patch: string;
  truncated: boolean;
  filePath: string | null;
};

function lineClass(line: string) {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
    return "text-zinc-500";
  }
  if (line.startsWith("@@")) {
    return "text-sky-400";
  }
  if (line.startsWith("+")) {
    return "text-emerald-400";
  }
  if (line.startsWith("-")) {
    return "text-red-400";
  }
  if (line.startsWith("# untracked")) {
    return "text-amber-300";
  }
  return "text-zinc-300";
}

export function DiffView({ patch, truncated, filePath }: DiffViewProps) {
  const lines = patch.length > 0 ? patch.split("\n") : [];

  return (
    <section id="diff-panel" className="flex min-w-0 flex-1 flex-col">
      <div id="diff-header" className="flex items-center gap-3 px-3 py-2">
        <h3 id="diff-title" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Diff
        </h3>
        {filePath ? (
          <p id="diff-file" className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={filePath}>
            {filePath}
          </p>
        ) : (
          <span id="diff-file-spacer" className="flex-1" />
        )}
        {truncated ? (
          <span id="diff-truncated" className="text-xs text-amber-400">
            Truncated
          </span>
        ) : null}
      </div>
      {lines.length === 0 ? (
        <p id="diff-empty" className="px-3 text-sm text-zinc-500">
          {filePath ? "No diff for this file." : "No diff to show."}
        </p>
      ) : (
        <pre
          id="diff-view"
          key={filePath ?? "diff"}
          className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-xs leading-5"
        >
          {lines.map((line, index) => (
            <div id={`diff-line-${index}`} key={`diff-line-${index}`} className={cn("whitespace-pre", lineClass(line))}>
              {line.length > 0 ? line : " "}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}
