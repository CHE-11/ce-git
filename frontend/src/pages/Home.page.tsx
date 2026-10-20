import { useEffect, useState } from "react";
import { ActionConfirmDialog } from "../components/Dialogs/ActionConfirmDialog";
import { AdvancedSearchDialog } from "../components/Dialogs/AdvancedSearchDialog";
import { AiReviewDialog } from "../components/Dialogs/AiReviewDialog";
import { SettingsDialog, type SettingsTab } from "../components/Dialogs/Settings/SettingsDialog";
import { CreateRepoDialog } from "../components/Dialogs/CreateRepoDialog";
import { ActivityLog } from "../components/ActivityLog";
import { GitPullConfirmationDialog } from "../components/Dialogs/GitPullConfirmationDialog";
import { GitPushConfirmationDialog } from "../components/Dialogs/GitPushConfirmationDialog";
import { RepoDetail } from "../components/RepoDetail";
import { RepoTree } from "../components/RepoTree";
import { StatusBar } from "../components/StatusBar";
import { Toolbar } from "../components/Toolbar";
import { useWorkspace } from "../lib/use-workspace";
import type { RepoTreeFilter } from "../lib/tree";

export function HomePage() {
  const workspace = useWorkspace();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState<RepoTreeFilter | null>(null);
  const [pendingAction, setPendingAction] = useState<"clear" | null>(null);

  useEffect(() => {
    document.title = "ce-git";
  }, []);

  const busy = workspace.busyAction !== null;
  let pullCount = 0;
  let pushCount = 0;
  for (const status of Object.values(workspace.statuses)) {
    if (status.error) {
      continue;
    }
    if (status.behind > 0) {
      pullCount += 1;
    }
    if (status.ahead > 0) {
      pushCount += 1;
    }
  }

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
        pullCount={pullCount}
        pushCount={pushCount}
        onOpenAppSettings={() => setSettingsTab("app")}
        onChooseFolder={() => void workspace.chooseFolder()}
        onRefresh={() => void workspace.refresh()}
        onPullAll={workspace.requestPullAll}
        onPushAll={workspace.requestPushAll}
        onAiCommitPrompt={workspace.startAiForDirty}
        onAddRoot={() => void workspace.addRootFolder()}
        onCreateNewRepo={() => setCreateRepoOpen(true)}
        onCommitClear={() => setPendingAction("clear")}
        onAdvancedSearch={() => setAdvancedSearchOpen(true)}
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
          onRevealInExplorer={(path) => void workspace.revealInExplorer(path)}
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
          fileHandlers={{
            discard: (file) => {
              if (workspace.activePath) {
                void workspace.discardChange(workspace.activePath, file);
              }
            },
            ignore: (kind, target) => {
              if (workspace.activePath) {
                void workspace.ignoreChange(workspace.activePath, kind, target);
              }
            },
            reveal: (relativePath) => {
              if (workspace.activePath) {
                void workspace.revealChange(workspace.activePath, relativePath);
              }
            },
            open: (relativePath, mode) => {
              if (workspace.activePath) {
                void workspace.openChange(workspace.activePath, relativePath, mode);
              }
            },
            reportError: workspace.reportError,
          }}
        />
      </div>
      <ActivityLog logs={workspace.logs} onClear={workspace.clearLogs} />
      <StatusBar
        rootPaths={workspace.rootPaths}
        branch={workspace.activeStatus?.branch ?? null}
        discovering={workspace.discovering}
        gitReady={workspace.gitReady}
      />


      {settingsTab ? (
        <SettingsDialog
          initialTab={settingsTab}
          selectedPrompt={workspace.selectedPrompt}
          onClose={() => setSettingsTab(null)}
          onSaved={(settings) => {
            void workspace.applyAppSettings(settings);
          }}
          onAiSaved={() => void workspace.refreshAi()}
        />
      ) : null}
      {createRepoOpen ? (
        <CreateRepoDialog onClose={() => setCreateRepoOpen(false)} onCreate={workspace.createNewRepo} />
      ) : null}
      <AdvancedSearchDialog
        open={advancedSearchOpen}
        trees={workspace.trees}
        initialSelected={workspace.selectedPaths}
        onClose={() => setAdvancedSearchOpen(false)}
        onOpenMatch={(repo, file) => {
          workspace.selectRepo(repo, "replace");
          void workspace.openChange(repo, file, "editor");
        }}
      />
      <AiReviewDialog open={workspace.aiOpen} drafts={workspace.drafts} generating={workspace.generating} busy={busy} onClose={() => workspace.setAiOpen(false)} onChange={workspace.updateDraft} onToggle={workspace.toggleDraft} onCommit={() => void workspace.commitDrafts()} />
      <GitPullConfirmationDialog
        pullPaths={workspace.pullPaths}
        logs={workspace.logs}
        error={workspace.error}
        onClose={() => workspace.setPullPaths(null)}
        onConfirm={workspace.confirmPull}
      />
      <GitPushConfirmationDialog
        pushPaths={workspace.pushPaths}
        logs={workspace.logs}
        error={workspace.error}
        onClose={() => workspace.setPushPaths(null)}
        onConfirm={workspace.confirmPush}
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
