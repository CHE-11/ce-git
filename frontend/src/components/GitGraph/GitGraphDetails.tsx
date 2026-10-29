import { Search, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommitDiff, GraphCommit } from "../../../../types/git";
import { cn } from "../../lib/cn";
import { patchForPath } from "../../lib/diff";
import { statusMark } from "../../lib/file-status";
import { commitDiff, resetToCommit, restoreCommit } from "../../lib/git-client";
import { absoluteTime } from "../../lib/time";
import { domId } from "../../lib/tree";
import { useResizableWidth } from "../../lib/use-resizable-width";
import { Button } from "../Button";
import { DiffView } from "../DiffView";
import { PaneResizer } from "../PaneResizer";
import { RestoreCommitDialog, type RestoreRequest } from "./RestoreCommitDialog";

type GitGraphDetailsProps = {
  path: string;
  commit: GraphCommit | null;
  head: string | null;
  onFilesRestored: () => void | Promise<void>;
  onBranchMoved: () => void | Promise<void>;
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

export function GitGraphDetails({ path, commit, head, onFilesRestored, onBranchMoved }: GitGraphDetailsProps) {
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
  const [checked, setChecked] = useState<string[]>([]);
  const [pending, setPending] = useState<RestoreRequest | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectionKey, setSelectionKey] = useState(key);

  if (selectionKey !== key) {
    setSelectionKey(key);
    setSelectedPath(null);
    setQuery("");
    setChecked([]);
    setPending(null);
    setActionError(null);
    setNotice(null);
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
  const restorePaths = checked.length > 0 ? checked : selectedFile ? [selectedFile.path] : [];
  const visiblePaths = visibleFiles.map((file) => file.path);
  const allVisibleChecked = visiblePaths.length > 0 && visiblePaths.every((filePath) => checked.includes(filePath));
  const someVisibleChecked = visiblePaths.some((filePath) => checked.includes(filePath));
  const isHead = commit !== null && head === commit.hash;

  function openRestore(request: RestoreRequest) {
    setActionError(null);
    setPending(request);
  }

  function toggleChecked(filePath: string) {
    setChecked((current) => (current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath]));
  }

  function toggleVisible() {
    setChecked((current) => {
      if (allVisibleChecked) return current.filter((item) => !visiblePaths.includes(item));
      const next = [...current];
      for (const filePath of visiblePaths) {
        if (!next.includes(filePath)) next.push(filePath);
      }
      return next;
    });
  }

  async function confirmRestore() {
    if (!commit || !pending) return;
    setWorking(true);
    setActionError(null);
    try {
      if (pending.kind === "branch") {
        await resetToCommit(path, commit.hash);
        setPending(null);
        setNotice(`This branch now points at ${commit.hash.slice(0, 7)}.`);
        await onBranchMoved();
      } else if (pending.kind === "tree") {
        await restoreCommit(path, commit.hash, null);
        setPending(null);
        await onFilesRestored();
      } else {
        await restoreCommit(path, commit.hash, pending.paths);
        setChecked([]);
        setPending(null);
        await onFilesRestored();
      }
    } catch (reason: unknown) {
      setActionError(errorText(reason));
    } finally {
      setWorking(false);
    }
  }

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
        <div id="git-graph-details-actions" className="mt-2 flex flex-wrap gap-1.5">
          <Button
            id="restore-repo"
            variant="secondary"
            size="xs"
            disabled={working}
            title="Make every tracked file match this commit. The branch stays where it is."
            onClick={() => openRestore({ kind: "tree" })}
          >
            <Undo2 id="restore-repo-icon" className="size-3.5" />
            <span id="restore-repo-label">Restore repo</span>
          </Button>
          <Button
            id="move-branch"
            variant="ghost"
            size="xs"
            disabled={working}
            title={isHead ? "Discard uncommitted changes so the files match this commit." : "Point the current branch at this commit and drop later commits on it."}
            className="text-rose-300 hover:bg-rose-950/50 hover:text-rose-200"
            onClick={() => openRestore({ kind: "branch" })}
          >
            <span id="move-branch-label">{isHead ? "Discard local changes" : "Move branch here"}</span>
          </Button>
        </div>
        <p id="git-graph-details-restore-hint" className="mt-1.5 text-xs text-zinc-500">
          Restore keeps this branch so you can commit the result. Moving the branch drops the commits after this one.
        </p>
      </header>
      {notice ? (
        <p id="git-graph-details-notice" className="border-b border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
          {notice}
        </p>
      ) : null}
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
          <div id="commit-files-toolbar" className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
            <label id="commit-files-select-all-row" className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
              <input
                id="commit-files-select-all"
                type="checkbox"
                className="size-3.5 accent-sky-500"
                checked={allVisibleChecked}
                disabled={working || visiblePaths.length === 0}
                aria-label="Select all files"
                ref={(element) => {
                  if (element) element.indeterminate = someVisibleChecked && !allVisibleChecked;
                }}
                onChange={toggleVisible}
              />
              <span id="commit-files-select-all-label" className="truncate">
                {checked.length > 0 ? `${checked.length} selected` : "Select"}
              </span>
            </label>
            <Button
              id="commit-files-restore"
              variant="secondary"
              size="xs"
              disabled={working || restorePaths.length === 0}
              title={checked.length > 0 ? "Make the checked files match this commit" : "Make the open file match this commit"}
              onClick={() => openRestore({ kind: "files", paths: restorePaths })}
            >
              <Undo2 id="commit-files-restore-icon" className="size-3.5" />
              <span id="commit-files-restore-label">{checked.length > 1 ? `Restore ${checked.length}` : "Restore file"}</span>
            </Button>
          </div>
          <h3 id="commit-files-title" className="flex items-center justify-between px-3 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
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
                  <li
                    id={domId("commit-file-item", itemKey)}
                    key={itemKey}
                    className={cn("flex items-center pr-1 hover:bg-zinc-800/80", selected && "bg-sky-950/70 hover:bg-sky-950/70")}
                  >
                    <input
                      id={domId("commit-file-check", itemKey)}
                      type="checkbox"
                      className="ml-2 size-3.5 shrink-0 accent-sky-500"
                      checked={checked.includes(file.path)}
                      disabled={working}
                      aria-label={`Select ${file.path}`}
                      onChange={() => toggleChecked(file.path)}
                    />
                    <button
                      id={domId("commit-file", itemKey)}
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      title={title}
                      onClick={() => setSelectedPath(file.path)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm"
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
                    <Button
                      id={domId("commit-file-restore", itemKey)}
                      variant="ghost"
                      size="xs"
                      className="h-6 shrink-0 px-1"
                      title={`Make ${file.path} match this commit`}
                      aria-label={`Restore ${file.path}`}
                      disabled={working}
                      onClick={() => openRestore({ kind: "files", paths: [file.path] })}
                    >
                      <Undo2 id={domId("commit-file-restore-icon", itemKey)} className="size-3.5" />
                    </Button>
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
      <RestoreCommitDialog
        request={pending}
        hash={commit.hash}
        subject={commit.subject}
        isHead={isHead}
        working={working}
        error={actionError}
        onClose={() => {
          if (!working) setPending(null);
        }}
        onConfirm={() => void confirmRestore()}
      />
    </section>
  );
}
