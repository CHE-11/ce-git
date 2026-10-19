import { useEffect, useState } from "react";
import { ActionConfirmDialog } from "../components/Dialogs/ActionConfirmDialog";
import { AiReviewDialog } from "../components/Dialogs/AiReviewDialog";
import { AiSettingsDialog } from "../components/Dialogs/AiSettingsDialog";
import { AppSettingsDialog } from "../components/Dialogs/AppSettingsDialog";
import { CreateRepoDialog } from "../components/Dialogs/CreateRepoDialog";
import { BatchLog } from "../components/BatchLog";
import { GitPushConfirmationDialog } from "../components/Dialogs/GitPushConfirmationDialog";
import { GitSettingsDialog } from "../components/Dialogs/GitSettingsDialog";
import { RepoDetail } from "../components/RepoDetail";
import { RepoTree } from "../components/RepoTree";
import { StatusBar } from "../components/StatusBar";
import { Toolbar } from "../components/Toolbar";
import { useWorkspace } from "../lib/use-workspace";
import type { RepoTreeFilter } from "../lib/tree";

export function HomePage() {
  const workspace = useWorkspace();
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [gitSettingsOpen, setGitSettingsOpen] = useState(false);
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState<RepoTreeFilter | null>(null);
  const [pendingAction, setPendingAction] = useState<"pull" | "clear" | null>(null);

  useEffect(() => {
    document.title = "ce-git";
  }, []);

  const busy = workspace.busyAction !== null;

  return (
    <div id="app-shell" className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <Toolbar
        rootPaths={workspace.rootPaths}
        repoCount={workspace.repos.length}
        prompts={workspace.commitPrompts}
        busy={busy}
        generating={workspace.generating}
        discovering={workspace.discovering}
        hasSelection={workspace.selectedPaths.length > 0}
        onOpenAppSettings={() => setAppSettingsOpen(true)}
        onChooseFolder={() => void workspace.chooseFolder()}
        onRefresh={() => void workspace.refresh()}
        onPullAll={() => setPendingAction("pull")}
        onPushAll={workspace.requestPushAll}
        onAiCommitPrompt={workspace.startAiForDirty}
        onOpenAiSettings={() => workspace.setAiSettingsOpen(true)}
        onOpenGitSettings={() => setGitSettingsOpen(true)}
        onAddRoot={() => void workspace.addRootFolder()}
        onCreateNewRepo={() => setCreateRepoOpen(true)}
        onCommitClear={() => setPendingAction("clear")}
      />
      {workspace.error ? (
        <p id="app-error" className="border-b border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {workspace.error}
        </p>
      ) : null}
      {!workspace.gitReady ? (
        <p id="git-missing" className="border-b border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
          Install Git and make sure `git` is on your PATH, then restart ce-git.
        </p>
      ) : null}
      <div id="workspace" className="flex min-h-0 flex-1">
        <RepoTree
          trees={workspace.trees}
          rootPaths={workspace.rootPaths}
          onAddRoot={() => void workspace.addRootFolder()}
          statuses={workspace.statuses}
          selectedPaths={workspace.selectedPaths}
          activePath={workspace.activePath}
          discovering={workspace.discovering}
          statusLoading={workspace.statusLoading}
          onSelect={workspace.selectRepo}
          selectedCount={workspace.selectedPaths.length}
          onPullSelected={() => void workspace.pullSelected()}
          onPushSelected={workspace.requestPushSelected}
          onClearSelection={workspace.clearSelection}
          busy={busy}
          removedRepos={workspace.removedRepos}
          onOpenInEditor={(path, editor) => void workspace.openInEditor(path, editor)}
          onRemoveRepo={(path) => void workspace.removeRepo(path)}
          onDeleteFolder={(path) => void workspace.deleteFolder(path)}
          onRestoreRemoved={() => void workspace.restoreRemoved()}
          repoCount={workspace.repos.length}
          filter={treeFilter}
          onFilter={setTreeFilter}
        />
        <RepoDetail
          path={workspace.activePath}
          status={workspace.activeStatus}
          diff={workspace.diff}
          diffLoading={workspace.diffLoading}
          commitMessage={workspace.commitMessage}
          commitDescription={workspace.commitDescription}
          commitPrompts={workspace.commitPrompts}
          selectedPrompt={workspace.selectedPrompt}
          busy={busy}
          generating={workspace.generating}
          openaiReady={workspace.openaiReady}
          onCommitMessage={workspace.setCommitMessage}
          onCommitDescription={workspace.setCommitDescription}
          onSelectedPrompt={workspace.setSelectedPrompt}
          onGenerate={workspace.generateForActive}
          onCommit={() => void workspace.commitActive()}
        />
      </div>
      <BatchLog logs={workspace.logs} onClear={workspace.clearLogs} />
      <StatusBar
        rootPaths={workspace.rootPaths}
        branch={workspace.activeStatus?.branch ?? null}
        discovering={workspace.discovering}
        gitReady={workspace.gitReady}
      />


      {appSettingsOpen ? (
        <AppSettingsDialog
          selectedPrompt={workspace.selectedPrompt}
          onClose={() => setAppSettingsOpen(false)}
          onSaved={(settings) => {
            void workspace.applyAppSettings(settings);
          }}
        />
      ) : null}
      <AiSettingsDialog open={workspace.aiSettingsOpen} onClose={() => workspace.setAiSettingsOpen(false)} onSaved={() => void workspace.refreshAi()} />
      {gitSettingsOpen ? <GitSettingsDialog onClose={() => setGitSettingsOpen(false)} /> : null}
      {createRepoOpen ? (
        <CreateRepoDialog onClose={() => setCreateRepoOpen(false)} onCreate={workspace.createNewRepo} />
      ) : null}
      <AiReviewDialog open={workspace.aiOpen} drafts={workspace.drafts} generating={workspace.generating} busy={busy} onClose={() => workspace.setAiOpen(false)} onChange={workspace.updateDraft} onToggle={workspace.toggleDraft} onCommit={() => void workspace.commitDrafts()} />
      <GitPushConfirmationDialog pushPaths={workspace.pushPaths} onClose={() => workspace.setPushPaths(null)} onConfirm={workspace.confirmPush} />
      <ActionConfirmDialog
        id="pull-confirm-dialog"
        title="Pull repositories"
        copy={`Pull ${workspace.repos.length} repositories. A dirty working tree is skipped. Each repo's default branch is fast-forwarded from origin.`}
        confirmLabel="Pull"
        open={pendingAction === "pull"}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          setPendingAction(null);
          void workspace.pullAll();
        }}
      />
      <ActionConfirmDialog
        id="clear-commits-dialog"
        title="Clear commit messages"
        copy="Clear the commit message and description, including AI review drafts that have not been committed."
        confirmLabel="Clear"
        open={pendingAction === "clear"}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          setPendingAction(null);
          workspace.clearCommitDrafts();
        }}
      />
    </div>
  );
}
