import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommitDiff, GraphCommit } from "../../../../types/git";
import { cn } from "../../lib/cn";
import { patchForPath } from "../../lib/diff";
import { statusMark } from "../../lib/file-status";
import { commitDiff } from "../../lib/git-client";
import { absoluteTime } from "../../lib/time";
import { domId } from "../../lib/tree";
import { useResizableWidth } from "../../lib/use-resizable-width";
import { Button } from "../Button";
import { DiffView } from "../DiffView";
import { PaneResizer } from "../PaneResizer";

type GitGraphDetailsProps = {
  path: string;
  commit: GraphCommit | null;
};

type LoadedDiff = {
  key: string;
  diff: CommitDiff | null;
  error: string | null;
};

function errorText(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Couldn't load this commit.";
}

function splitPath(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return { name: path, folder: "" };
  return { name: path.slice(index + 1), folder: path.slice(0, index) };
}

function messageBody(message: string) {
  const newline = message.indexOf("\n");
  if (newline < 0) return "";
  return message.slice(newline + 1).trim();
}

export function GitGraphDetails({ path, commit }: GitGraphDetailsProps) {
  const filesPane = useResizableWidth({
    storageKey: "ce-git.commit-files-width",
    defaultWidth: 256,
    minWidth: 160,
    maxWidth: 560,
    maxFraction: 0.35,
  });
  const key = commit ? `${path}\n${commit.hash}` : "";
  const [loaded, setLoaded] = useState<LoadedDiff | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectionKey, setSelectionKey] = useState(key);

  if (selectionKey !== key) {
    setSelectionKey(key);
    setSelectedPath(null);
    setQuery("");
  }

  useEffect(() => {
    if (!commit) return;
    const requestKey = `${path}\n${commit.hash}`;
    let cancelled = false;
    commitDiff(path, commit.hash)
      .then((diff) => {
        if (!cancelled) setLoaded({ key: requestKey, diff, error: null });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoaded({ key: requestKey, diff: null, error: errorText(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, commit]);

  const current = loaded?.key === key ? loaded : null;
  const diff = current?.diff ?? null;
  const files = useMemo(() => diff?.files ?? [], [diff]);
  const needle = query.trim().toLowerCase();
  const visibleFiles = useMemo(
    () =>
      needle
        ? files.filter((file) => file.path.toLowerCase().includes(needle) || (file.previousPath ?? "").toLowerCase().includes(needle))
        : files,
    [files, needle],
  );
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const selectedPatch = patchForPath(diff?.patch ?? "", selectedFile?.path ?? null);

  if (!commit) {
    return (
      <section id="git-graph-details" className="flex min-w-0 flex-1 items-center justify-center">
        <p id="git-graph-details-empty" className="text-sm text-zinc-500">
          Select a commit to see its changes.
        </p>
      </section>
    );
  }

  const body = messageBody(diff?.message ?? "");

  return (
    <section id="git-graph-details" className="flex min-w-0 flex-1 flex-col">
      <header id="git-graph-details-header" className="border-b border-zinc-800 px-3 py-2">
        <p id="git-graph-details-subject" className="truncate text-sm font-semibold text-zinc-100" title={commit.subject}>
          {commit.subject || "(no message)"}
        </p>
        <div id="git-graph-details-meta" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
          <span id="git-graph-details-author" className="text-zinc-300">
            {commit.author || "Unknown"}
          </span>
          <span id="git-graph-details-time">{absoluteTime(commit.date)}</span>
          <span id="git-graph-details-hash" className="font-mono text-zinc-400" title={commit.hash}>
            {commit.hash.slice(0, 7)}
          </span>
          <span id="git-graph-details-parents" className="font-mono">
            {commit.parents.length === 0
              ? "No parents"
              : `${commit.parents.length === 1 ? "Parent" : "Parents"} ${commit.parents.map((parent) => parent.slice(0, 7)).join(" ")}`}
          </span>
        </div>
        {body ? (
          <p id="git-graph-details-body" className="mt-2 max-h-32 overflow-auto text-xs whitespace-pre-wrap text-zinc-400">
            {body}
          </p>
        ) : null}
      </header>
      {current?.error ? (
        <p id="git-graph-details-error" className="border-b border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {current.error}
        </p>
      ) : null}
      <div id="git-graph-details-body-row" className="flex min-h-0 flex-1">
        <section id="commit-files-panel" style={{ width: filesPane.width }} className="relative flex shrink-0 flex-col border-r border-zinc-800">
          <form
            id="commit-files-search"
            className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5"
            onSubmit={(event) => event.preventDefault()}
          >
            <Search id="commit-files-search-icon" className="size-3.5 shrink-0 text-zinc-500" />
            <input
              id="commit-files-search-input"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter files"
              aria-label="Filter files"
              className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {query ? (
              <Button id="commit-files-search-clear" variant="ghost" size="xs" className="h-6 px-1" title="Clear filter" aria-label="Clear filter" onClick={() => setQuery("")}>
                <X id="commit-files-search-clear-icon" className="size-3.5" />
              </Button>
            ) : null}
          </form>
          <h3 id="commit-files-title" className="flex items-center justify-between px-3 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            <span id="commit-files-title-label">Changed files</span>
            {diff ? (
              <span id="commit-files-count" className="font-normal tracking-normal normal-case">
                {files.length}
              </span>
            ) : null}
          </h3>
          {!current ? (
            <p id="commit-files-loading" className="px-3 text-sm text-zinc-500">
              Loading changes…
            </p>
          ) : files.length === 0 ? (
            <p id="commit-files-empty" className="px-3 text-sm text-zinc-500">
              {current.error ? "No files to show." : "No file changes in this commit."}
            </p>
          ) : visibleFiles.length === 0 ? (
            <p id="commit-files-search-empty" className="px-3 text-sm text-zinc-500">
              No files match “{query.trim()}”.
            </p>
          ) : (
            <ul id="commit-files" className="min-h-0 flex-1 overflow-auto">
              {visibleFiles.map((file) => {
                const selected = file.path === selectedFile?.path;
                const itemKey = `${file.status}-${file.path}`;
                const mark = statusMark(file.status);
                const { name, folder } = splitPath(file.path);
                const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
                return (
                  <li id={domId("commit-file-item", itemKey)} key={itemKey}>
                    <button
                      id={domId("commit-file", itemKey)}
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      title={title}
                      onClick={() => setSelectedPath(file.path)}
                      className={cn("flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800/80", selected && "bg-sky-950/70")}
                    >
                      <span
                        id={domId("commit-file-status", itemKey)}
                        title={mark.label}
                        aria-label={mark.label}
                        className={cn("w-4 shrink-0 text-center text-xs font-semibold", mark.className)}
                      >
                        {mark.letter}
                      </span>
                      <span id={domId("commit-file-name", itemKey)} className="shrink-0 truncate text-zinc-200">
                        {name}
                      </span>
                      {folder ? (
                        <span id={domId("commit-file-folder", itemKey)} className="min-w-0 truncate text-xs text-zinc-500">
                          {folder}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <PaneResizer id="commit-files-resizer" label="Resize changed files" resizable={filesPane} />
        </section>
        {current?.diff ? (
          <DiffView
            patch={selectedPatch.text}
            truncated={selectedPatch.truncated || (current.diff.truncated && !selectedPatch.text)}
            filePath={selectedFile?.path ?? null}
          />
        ) : (
          <div id="commit-diff-placeholder" className="min-w-0 flex-1" />
        )}
      </div>
    </section>
  );
}
