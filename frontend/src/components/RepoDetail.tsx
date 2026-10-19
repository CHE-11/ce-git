import { useState } from "react";
import type { AiPrompts, RepoDiff, RepoStatus } from "../../../types/git";
import { patchForPath } from "../lib/diff";
import { baseName } from "../lib/tree";
import { Badge } from "./Badge";
import { ChangedFiles } from "./ChangedFiles";
import { CommitBox } from "./CommitBox";
import { DiffView } from "./DiffView";

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
}: RepoDetailProps) {
  const files = diff?.files ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectionRepo, setSelectionRepo] = useState(path);
  if (selectionRepo !== path) {
    setSelectionRepo(path);
    setSelectedPath(null);
  }
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const selectedPatch = patchForPath(diff?.patch ?? "", selectedFile?.path ?? null);

  if (!path) {
    return (
      <section id="repo-detail" className="flex min-w-0 flex-1 items-center justify-center bg-zinc-950">
        <p id="repo-detail-empty" className="text-sm text-zinc-500">
          Select a repository to see its changes.
        </p>
      </section>
    );
  }

  const name = status?.name ?? baseName(path);

  return (
    <section id="repo-detail" className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      <header id="repo-detail-header" className="border-b border-zinc-800 px-4 py-3">
        <h2 id="repo-detail-name" className="truncate text-lg font-semibold text-zinc-100">
          {name}
        </h2>
        <p id="repo-detail-path" className="truncate text-xs text-zinc-500" title={path}>
          {path}
        </p>
        <div id="repo-detail-badges" className="mt-2 flex flex-wrap gap-1.5">
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
            <ChangedFiles files={files} selectedPath={selectedFile?.path ?? null} onSelect={setSelectedPath} />
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
    </section>
  );
}
