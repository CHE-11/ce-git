import { ArrowDownToLine, ArrowUpToLine, GitGraph, Loader2, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import type { AiPrompts, PublishOptions, RepoDiff, RepoStatus } from "../../../../types/git";
import type { EditorId } from "../../lib/editors";
import { patchForPath } from "../../lib/diff";
import { baseName } from "../../lib/tree";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { ChangedFiles, type ChangeFileHandlers } from "./ChangedFiles/ChangedFiles";
import { CommitBox } from "./CommitBox";
import { PublishDialog } from "../Dialogs/PublishDialog";
import { DiffView } from "../DiffView";

function CommitCountBadge({ id, count, tone }: { id: string; count: number; tone: "pull" | "push" }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      id={id}
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ${
        tone === "pull" ? "bg-sky-950 text-sky-100" : "bg-emerald-950 text-emerald-300"
      }`}
    >
      {count}
    </span>
  );
}

function commitCountLabel(count: number) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

type RepoDetailProps = {
  path: string | null;
  status: RepoStatus | null;
  diff: RepoDiff | null;
  diffLoading: boolean;
  commitMessage: string;
  commitDescription: string;
  commitPrompts: AiPrompts;
  selectedPrompt: number;
  busy: boolean;
  generating: boolean;
  openaiReady: boolean | null;
  onCommitMessage: (message: string) => void;
  onCommitDescription: (description: string) => void;
  onSelectedPrompt: (slot: number) => void;
  onGenerate: () => void;
  onCommit: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onPull: () => void;
  onPush: () => void;
  onPublish: (options: PublishOptions) => Promise<void>;
  fileHandlers: ChangeFileHandlers;
  menuEditors: readonly EditorId[];
  graphOpen: boolean;
  onToggleGraph: () => void;
};

export function RepoDetail({
  path,
  status,
  diff,
  diffLoading,
  commitMessage,
  commitDescription,
  commitPrompts,
  selectedPrompt,
  busy,
  generating,
  openaiReady,
  onCommitMessage,
  onCommitDescription,
  onSelectedPrompt,
  onGenerate,
  onCommit,
  onRefresh,
  refreshing,
  onPull,
  onPush,
  onPublish,
  fileHandlers,
  menuEditors,
  graphOpen,
  onToggleGraph,
}: RepoDetailProps) {
  const files = diff?.files ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectionRepo, setSelectionRepo] = useState(path);
  if (selectionRepo !== path) {
    setSelectionRepo(path);
    setSelectedPath(null);
    setPublishOpen(false);
  }
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const selectedPatch = patchForPath(diff?.patch ?? "", selectedFile?.path ?? null);

  if (!path) {
    return (
      <section id="repo-detail" className="flex min-w-0 flex-1 flex-col bg-zinc-950">
        <div id="repo-detail-empty-wrap" className="flex flex-1 items-center justify-center">
          <p id="repo-detail-empty" className="text-sm text-zinc-500">
            Select a repository to see its changes.
          </p>
        </div>
      </section>
    );
  }

  const name = status?.name ?? baseName(path);
  const unpublished = status !== null && status.github === null && !status.error;
  const published = status !== null && status.github !== null && !status.error;
  const canPublish = unpublished && Boolean(status?.hasCommits) && !busy;
  const publishTitle = status !== null && !status.hasCommits ? "Commit something before publishing" : "Create this repository on GitHub";
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const untrackedBranch = Boolean(status?.hasCommits) && status?.upstream == null && !status?.detached;
  const canPush = !busy && (ahead > 0 || untrackedBranch);
  const pushTitle =
    ahead > 0
      ? `Push ${commitCountLabel(ahead)}`
      : untrackedBranch
        ? "Push this branch and set its upstream"
        : "No commits to push";
  const pullTitle =
    behind > 0
      ? `Pull ${commitCountLabel(behind)}. A branch that is ahead is merged.`
      : "Pull the default branch. A branch that is ahead is merged.";

  return (
    <section id="repo-detail" className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      <header id="repo-detail-header" className="border-b border-zinc-800 px-4 py-3">
        <div id="repo-detail-title-row" className="flex items-center justify-between gap-3">
          <h2 id="repo-detail-name" className="min-w-0 truncate text-lg font-semibold text-zinc-100">
            {name}
          </h2>
          <div id="repo-detail-actions" className="flex shrink-0 items-center gap-1.5">
            <Button
              id="repo-refresh-button"
              variant="secondary"
              size="sm"
              className={refreshing ? "size-7 px-0 disabled:opacity-100" : "size-7 px-0"}
              onClick={onRefresh}
              disabled={busy || refreshing}
              aria-busy={refreshing}
              aria-label="Refresh this repository"
              title="Refresh this repository"
            >
              {refreshing ? (
                <Loader2 id="repo-refresh-spinner" className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw id="repo-refresh-icon" className="size-3.5" />
              )}
            </Button>
            {unpublished ? (
              <span id="repo-publish-wrap" className="inline-flex" title={publishTitle}>
                <Button
                  id="repo-publish-button"
                  variant="primary"
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-500 disabled:pointer-events-none"
                  onClick={() => setPublishOpen(true)}
                  disabled={!canPublish}
                  title={publishTitle}
                >
                  <Upload id="repo-publish-icon" className="size-3.5" />
                  <span id="repo-publish-label">Publish</span>
                </Button>
              </span>
            ) : null}
            {published ? (
              <>
                <Button id="repo-pull-button" variant="primary" size="sm" onClick={onPull} disabled={busy} title={pullTitle}>
                  <ArrowDownToLine id="repo-pull-icon" className="size-3.5" />
                  <span id="repo-pull-label">Pull</span>
                  <CommitCountBadge id="repo-pull-count" count={behind} tone="pull" />
                </Button>
                <Button id="repo-push-button" variant="secondary" size="sm" onClick={onPush} disabled={!canPush} title={pushTitle}>
                  <ArrowUpToLine id="repo-push-icon" className="size-3.5" />
                  <span id="repo-push-label">Push</span>
                  <CommitCountBadge id="repo-push-count" count={ahead} tone="push" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <p id="repo-detail-path" className="truncate text-xs text-zinc-500" title={path}>
          {path}
        </p>
        <div id="repo-detail-badges" className="mt-2 flex flex-wrap gap-1.5">
          <Badge id="badge-graph" tone={graphOpen ? "violet" : "grey"} title="Commit graph" pressed={graphOpen} onClick={onToggleGraph}>
            <GitGraph className="size-3.5" />
          </Badge>
          <Badge id="badge-branch" tone="blue">
            {status?.branch ?? "…"}
          </Badge>
          {status?.upstream ? (
            <Badge id="badge-upstream">{status.upstream}</Badge>
          ) : (
            <Badge id="badge-upstream">No upstream</Badge>
          )}
          <Badge id="badge-ahead" tone={status && status.ahead > 0 ? "green" : "neutral"}>
            ↑ {status?.ahead ?? 0}
          </Badge>
          <Badge id="badge-behind" tone={status && status.behind > 0 ? "amber" : "neutral"}>
            ↓ {status?.behind ?? 0}
          </Badge>
          {status?.defaultBranch ? <Badge id="badge-default">default {status.defaultBranch}</Badge> : null}
          {status ? (
            status.dirty ? (
              <Badge id="badge-dirty" tone="amber">
                Uncommitted
              </Badge>
            ) : (
              <Badge id="badge-clean" tone="green">
                Clean
              </Badge>
            )
          ) : null}
        </div>
        {status?.error ? (
          <p id="repo-detail-error" className="mt-2 text-sm text-red-400">
            {status.error}
          </p>
        ) : null}
      </header>
      <div id="repo-detail-body" className="flex min-h-0 flex-1">
        {diffLoading && !diff ? (
          <p id="repo-detail-loading" className="px-4 py-6 text-sm text-zinc-500">
            Loading changes…
          </p>
        ) : (
          <>
            <ChangedFiles
              repoPath={path}
              files={files}
              selectedPath={selectedFile?.path ?? null}
              busy={busy}
              handlers={fileHandlers}
              menuEditors={menuEditors}
              onSelect={setSelectedPath}
            />
            <DiffView patch={selectedPatch.text} truncated={selectedPatch.truncated} filePath={selectedFile?.path ?? null} />
          </>
        )}
      </div>
      <CommitBox
        message={commitMessage}
        description={commitDescription}
        prompts={commitPrompts}
        selectedPrompt={selectedPrompt}
        dirty={status?.dirty ?? false}
        busy={busy}
        generating={generating}
        openaiReady={openaiReady}
        onChange={onCommitMessage}
        onDescription={onCommitDescription}
        onPrompt={onSelectedPrompt}
        onGenerate={onGenerate}
        onCommit={onCommit}
      />
      <PublishDialog
        open={publishOpen}
        repoName={name}
        onClose={() => setPublishOpen(false)}
        onPublish={async (options) => {
          await onPublish(options);
          setPublishOpen(false);
        }}
      />
    </section>
  );
}
