import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { readDiffLayout, storeDiffLayout, type DiffLayout } from "../lib/diff-layout";
import { splitRows, type SplitRow, type SplitSide } from "../lib/split-diff";

type DiffViewProps = {
  patch: string;
  truncated: boolean;
  filePath: string | null;
  placeholder?: string;
};

const LAYOUTS: { id: DiffLayout; label: string; title: string }[] = [
  { id: "unified", label: "Unified", title: "Show removed and added lines in one column" },
  { id: "split", label: "Split", title: "Show the old file on the left and the new file on the right" },
];

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

function sideClass(row: SplitRow, side: "left" | "right") {
  if (row.kind === "removed" && side === "left") {
    return "bg-red-950/50 text-red-300";
  }
  if (row.kind === "added" && side === "right") {
    return "bg-emerald-950/50 text-emerald-300";
  }
  if (row.kind === "changed") {
    return side === "left" ? "bg-red-950/50 text-red-300" : "bg-emerald-950/50 text-emerald-300";
  }
  if (row.kind === "removed" || row.kind === "added") {
    return "bg-zinc-900/60";
  }
  return "text-zinc-300";
}

function SplitCells({ row, index, value, side }: { row: SplitRow; index: number; value: SplitSide | null; side: "left" | "right" }) {
  const tone = sideClass(row, side);
  return (
    <>
      <span
        id={`diff-split-${side}-number-${index}`}
        className={cn("pr-2 text-right text-zinc-600 select-none", tone, side === "right" && "border-l border-zinc-800")}
      >
        {value?.line ?? ""}
      </span>
      <span id={`diff-split-${side}-text-${index}`} className={cn("min-w-0 pr-3 break-all whitespace-pre-wrap", tone)}>
        {value && value.text.length > 0 ? value.text : " "}
      </span>
    </>
  );
}

function SplitView({ rows, filePath }: { rows: SplitRow[]; filePath: string | null }) {
  return (
    <div
      id="diff-view-split"
      key={filePath ?? "diff"}
      className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-xs leading-5"
    >
      <div id="diff-split-grid" className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]">
        {rows.map((row, index) =>
          row.kind === "meta" || row.kind === "hunk" ? (
            <div
              id={`diff-split-${row.kind}-${index}`}
              key={`diff-split-${index}`}
              className={cn(
                "col-span-4 truncate",
                row.kind === "hunk" ? "mt-1 bg-sky-950/30 text-sky-400" : "text-zinc-500",
                row.kind === "meta" && row.text.startsWith("# untracked") && "text-amber-300",
              )}
              title={row.text}
            >
              {row.text.length > 0 ? row.text : " "}
            </div>
          ) : (
            <div id={`diff-split-row-${index}`} key={`diff-split-${index}`} className="contents">
              <SplitCells row={row} index={index} value={row.left} side="left" />
              <SplitCells row={row} index={index} value={row.right} side="right" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function DiffView({ patch, truncated, filePath, placeholder }: DiffViewProps) {
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout);
  const lines = patch.length > 0 ? patch.split("\n") : [];
  const rows = useMemo(() => (layout === "split" && patch.length > 0 ? splitRows(patch) : []), [layout, patch]);

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
        <div
          id="diff-layout-toggle"
          role="group"
          aria-label="Diff layout"
          className="inline-flex shrink-0 overflow-hidden rounded border border-zinc-700"
        >
          {LAYOUTS.map((option) => (
            <button
              id={`diff-layout-${option.id}`}
              key={option.id}
              type="button"
              aria-pressed={layout === option.id}
              title={option.title}
              onClick={() => setLayout(storeDiffLayout(option.id))}
              className={cn(
                "px-2 py-0.5 text-xs font-medium",
                layout === option.id ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {truncated ? (
          <span id="diff-truncated" className="text-xs text-amber-400">
            Truncated
          </span>
        ) : null}
      </div>
      {lines.length === 0 ? (
        <p id="diff-empty" className="px-3 text-sm text-zinc-500">
          {placeholder ?? (filePath ? "No diff for this file." : "No diff to show.")}
        </p>
      ) : layout === "split" ? (
        <SplitView rows={rows} filePath={filePath} />
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
