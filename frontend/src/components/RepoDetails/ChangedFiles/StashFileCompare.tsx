import { useMemo, useRef, useState, type UIEvent } from "react";
import type { StashFileView, StashKeepSource } from "../../../../../types/git";
import { cn } from "../../../lib/cn";
import { diffLines, type DiffRow } from "../../../lib/line-diff";
import { ActionConfirmDialog } from "../../Dialogs/ActionConfirmDialog";
import { Button } from "../../Button";

type StashFileCompareProps = {
  path: string | null;
  view: StashFileView | null;
  loading: boolean;
  busy: boolean;
  locked: boolean;
  onKeep: (source: StashKeepSource) => void;
};

const LOCKED_TITLE = "This stash belongs to a pull in progress.";

function plainRows(text: string, side: "remote" | "stash"): DiffRow[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.map((line, index) => ({
    kind: "same" as const,
    remote: side === "remote" ? line : null,
    remoteLine: side === "remote" ? index + 1 : null,
    stash: side === "stash" ? line : null,
    stashLine: side === "stash" ? index + 1 : null,
    remoteSpans: null,
    stashSpans: null,
  }));
}

function rowClass(side: "remote" | "stash", kind: DiffRow["kind"]) {
  if (kind === "removed" && side === "remote") {
    return "bg-red-950/50";
  }
  if (kind === "added" && side === "stash") {
    return "bg-emerald-950/50";
  }
  if (kind === "changed") {
    return side === "remote" ? "bg-red-950/30" : "bg-emerald-950/30";
  }
  return "";
}

function spanClass(side: "remote" | "stash") {
  return side === "remote" ? "bg-red-800/80" : "bg-emerald-800/70";
}

function SidePanel({
  id,
  title,
  refName,
  rows,
  text,
  side,
  missing,
  missingCopy,
  binary,
  truncated,
  paneRef,
  onScroll,
}: {
  id: string;
  title: string;
  refName: string;
  rows: DiffRow[] | null;
  text: string;
  side: "remote" | "stash";
  missing: boolean;
  missingCopy: string;
  binary: boolean;
  truncated: boolean;
  paneRef?: (node: HTMLPreElement | null) => void;
  onScroll?: (event: UIEvent<HTMLPreElement>) => void;
}) {
  return (
    <section id={id} className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-zinc-800 first:border-l-0">
      <div id={`${id}-header`} className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <h3 id={`${id}-title`} className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {title}
        </h3>
        <p id={`${id}-ref`} className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={refName}>
          {refName}
        </p>
        {truncated ? (
          <span id={`${id}-truncated`} className="text-xs text-amber-400">
            Truncated for display
          </span>
        ) : null}
      </div>
      {missing ? (
        <p id={`${id}-missing`} className="px-3 py-3 text-sm text-zinc-500">
          {missingCopy}
        </p>
      ) : binary ? (
        <p id={`${id}-binary`} className="px-3 py-3 text-sm text-zinc-500">
          Binary file
        </p>
      ) : (
        <pre
          id={`${id}-view`}
          ref={paneRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-zinc-300"
        >
          {(rows ?? plainRows(text, side)).map((row, index) => {
            const text = side === "remote" ? row.remote : row.stash;
            const lineNo = side === "remote" ? row.remoteLine : row.stashLine;
            const spans = side === "remote" ? row.remoteSpans : row.stashSpans;
            const blank = text === null;
            return (
              <div
                id={`${id}-line-${index}`}
                key={`${id}-line-${index}`}
                className={cn("flex h-5 gap-3 whitespace-pre", !blank && rowClass(side, row.kind))}
              >
                <span id={`${id}-number-${index}`} className="w-8 shrink-0 text-right text-zinc-600 select-none">
                  {lineNo ?? ""}
                </span>
                <span id={`${id}-text-${index}`}>
                  {blank
                    ? " "
                    : spans
                      ? spans.map((span, spanIndex) => (
                          <span
                            id={`${id}-span-${index}-${spanIndex}`}
                            key={`${id}-span-${index}-${spanIndex}`}
                            className={span.changed ? spanClass(side) : undefined}
                          >
                            {span.text.length > 0 ? span.text : " "}
                          </span>
                        ))
                      : text.length > 0
                        ? text
                        : " "}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </section>
  );
}

export function StashFileCompare({ path, view, loading, busy, locked, onKeep }: StashFileCompareProps) {
  const [pending, setPending] = useState<StashKeepSource | null>(null);
  const remotePane = useRef<HTMLPreElement | null>(null);
  const stashPane = useRef<HTMLPreElement | null>(null);
  const scrolling = useRef<"remote" | "stash" | null>(null);
  const comparable = Boolean(view && !view.remoteMissing && !view.stashMissing && !view.remoteBinary && !view.stashBinary);
  const rows = useMemo(
    () => (comparable && view ? diffLines(view.remoteText, view.stashText) : null),
    [comparable, view],
  );

  function syncScroll(source: "remote" | "stash", event: UIEvent<HTMLPreElement>) {
    const echo = source === "remote" ? "stash" : "remote";
    if (scrolling.current === echo) {
      return;
    }
    const other = source === "remote" ? stashPane.current : remotePane.current;
    if (!other) {
      return;
    }
    scrolling.current = source;
    other.scrollTop = event.currentTarget.scrollTop;
    other.scrollLeft = event.currentTarget.scrollLeft;
    scrolling.current = null;
  }
  const remoteTitle = view?.onRemote ? "On remote" : "Current commit";
  const remoteRef = view?.remoteRef ?? "";
  const disabled = busy || locked || !path || !view;
  const remoteRemoves = Boolean(view?.remoteMissing);
  const stashRemoves = Boolean(view?.stashMissing);

  function confirmCopy(source: StashKeepSource) {
    if (!path) {
      return "";
    }
    if (source === "remote" && remoteRemoves) {
      return `Remove ${path} from the working tree? It is not on ${remoteRef}. The stash stays.`;
    }
    if (source === "stash" && stashRemoves) {
      return `Remove ${path} from the working tree? It is not in this stash. The stash stays.`;
    }
    if (source === "remote") {
      return `Replace the working copy of ${path} with the version on ${remoteRef}? The stash stays.`;
    }
    return `Replace the working copy of ${path} with the stashed version? The stash stays.`;
  }

  return (
    <section id="stash-compare" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div id="stash-compare-toolbar" className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <p id="stash-compare-path" className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={path ?? ""}>
          {path ?? "Stash"}
        </p>
        <Button
          id="stash-compare-keep-remote"
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={locked ? LOCKED_TITLE : "Write the remote copy into the working tree"}
          onClick={() => setPending("remote")}
        >
          <span id="stash-compare-keep-remote-label">Keep remote</span>
        </Button>
        <Button
          id="stash-compare-keep-stash"
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={locked ? LOCKED_TITLE : "Write the stashed copy into the working tree"}
          onClick={() => setPending("stash")}
        >
          <span id="stash-compare-keep-stash-label">Keep stash</span>
        </Button>
      </div>
      {loading || !view ? (
        <p id="stash-compare-loading" className="px-3 py-6 text-sm text-zinc-500">
          {path ? "Loading file…" : "Loading stash…"}
        </p>
      ) : (
        <div id="stash-compare-panels" className="flex min-h-0 flex-1">
          <SidePanel
            id="stash-compare-remote"
            title={remoteTitle}
            refName={remoteRef}
            rows={rows}
            text={view.remoteText}
            side="remote"
            missing={view.remoteMissing}
            missingCopy={`Not on ${remoteRef}.`}
            binary={view.remoteBinary}
            truncated={view.remoteTruncated}
            paneRef={(node) => {
              remotePane.current = node;
            }}
            onScroll={(event) => syncScroll("remote", event)}
          />
          <SidePanel
            id="stash-compare-stash"
            title="In stash"
            refName={path ?? ""}
            rows={rows}
            text={view.stashText}
            side="stash"
            missing={view.stashMissing}
            missingCopy="Not in this stash."
            binary={view.stashBinary}
            truncated={view.stashTruncated}
            paneRef={(node) => {
              stashPane.current = node;
            }}
            onScroll={(event) => syncScroll("stash", event)}
          />
        </div>
      )}
      <ActionConfirmDialog
        id="stash-keep-dialog"
        title={pending === "stash" ? "Keep stash" : "Keep remote"}
        copy={pending ? confirmCopy(pending) : ""}
        confirmLabel={pending === "stash" ? "Keep stash" : "Keep remote"}
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) {
            return;
          }
          const source = pending;
          setPending(null);
          onKeep(source);
        }}
      />
    </section>
  );
}
