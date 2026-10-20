import { useEffect, useState } from "react";
import { CommandPalette, type CommandItem } from "../components/CommandPalette";
import { ActionConfirmDialog } from "../components/Dialogs/ActionConfirmDialog";
import { AdvancedSearchDialog } from "../components/Dialogs/AdvancedSearchDialog";
import { AiReviewDialog } from "../components/Dialogs/AiReviewDialog";
import { SettingsDialog, type SettingsTab } from "../components/Dialogs/Settings/SettingsDialog";
import { CloneRepoDialog } from "../components/Dialogs/CloneRepoDialog";
import { CreateRepoDialog } from "../components/Dialogs/CreateRepoDialog";
import { ActivityLog } from "../components/ActivityLog";
import { GitPullConfirmationDialog } from "../components/Dialogs/GitPullConfirmationDialog";
import { GitPushConfirmationDialog } from "../components/Dialogs/GitPushConfirmationDialog";
import { RepoDetail } from "../components/RepoDetail";
import { RepoTree } from "../components/RepoTree/RepoTree";
import { StatusBar } from "../components/StatusBar";
import { Toolbar } from "../components/Toolbar";
import { useWorkspace } from "../lib/use-workspace";
import type { RepoTreeFilter } from "../lib/tree";

export function HomePage() {
  const workspace = useWorkspace();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [cloneRepoOpen, setCloneRepoOpen] = useState(false);
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState<RepoTreeFilter | null>(null);
  const [pendingAction, setPendingAction] = useState<"clear" | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);

  useEffect(() => {
    document.title = "ce-git";
  }, []);

  const busy = workspace.busyAction !== null;
  const hasRoots = workspace.rootPaths.length > 0;
  const hasRepos = workspace.repos.length > 0;
  const hasSelection = workspace.selectedPaths.length > 0;
  const hasActive = workspace.activePath !== null;
  const commands: CommandItem[] = [
    {
      id: "open-folder",
      label: "Open folder",
      group: "Workspace",
      keywords: "choose tree",
      disabled: busy,
      run: () => void workspace.chooseFolder(),
    },
    {
      id: "add-folder",
      label: "Add folder",
      group: "Workspace",
      keywords: "root tree",
      disabled: busy,
      run: () => void workspace.addRootFolder(),
    },
    {
      id: "create-repo",
      label: "Create repository",
      group: "Workspace",
      keywords: "new repo",
      disabled: busy,
      run: () => setCreateRepoOpen(true),
    },
    {
      id: "clone-repo",
      label: "Clone repository",
      group: "Workspace",
      keywords: "git clone",
      disabled: busy,
      run: () => setCloneRepoOpen(true),
    },
    {
      id: "advanced-search",
      label: "Advanced search",
      group: "Workspace",
      keywords: "find file",
      disabled: busy || !hasRoots,
      run: () => setAdvancedSearchOpen(true),
    },
    {
      id: "refresh",
      label: "Refresh repositories",
      group: "Workspace",
      keywords: "scan reload",
      disabled: busy || !hasRoots,
      run: () => void workspace.refresh(),
    },
    {
      id: "clear-commits",
      label: "Clear commit messages",
      group: "Workspace",
      keywords: "drafts",
      disabled: busy,
      run: () => setPendingAction("clear"),
    },
    {
      id: "restore-removed",
      label: "Restore removed repositories",
      group: "Workspace",
      keywords: "undo hide",
      disabled: busy || workspace.removedRepos.length === 0,
      run: () => void workspace.restoreRemoved(),
    },
    {
      id: "pull-all",
      label: "Pull all repositories",
      group: "Git",
      disabled: busy || !hasRepos,
      run: () => workspace.requestPullAll(),
    },
    {
      id: "push-all",
      label: "Push all repositories",
      group: "Git",
      disabled: busy || !hasRepos,
      run: () => workspace.requestPushAll(),
    },
    {
      id: "pull-selected",
      label: "Pull selected repositories",
      group: "Git",
      disabled: busy || !hasSelection,
      run: () => void workspace.pullSelected(),
    },
    {
      id: "push-selected",
      label: "Push selected repositories",
      group: "Git",
      disabled: busy || !hasSelection,
      run: () => workspace.requestPushSelected(),
    },
    {
      id: "pull-active",
      label: "Pull active repository",
      group: "Git",
      disabled: busy || !hasActive,
      run: () => workspace.requestPullActive(),
    },
    {
      id: "push-active",
      label: "Push active repository",
      group: "Git",
      disabled: busy || !hasActive,
      run: () => workspace.requestPushActive(),
    },
    {
      id: "settings-app",
      label: "App settings",
      group: "Settings",
      keywords: "theme zoom folder",
      disabled: busy,
      run: () => setSettingsTab("app"),
    },
    {
      id: "settings-git",
      label: "Git settings",
      group: "Settings",
      keywords: "name email sign in",
      disabled: busy,
      run: () => setSettingsTab("git"),
    },
    {
      id: "settings-ai",
      label: "AI settings",
      group: "Settings",
      keywords: "openai prompt model",
      disabled: busy,
      run: () => setSettingsTab("ai"),
    },
    {
      id: "settings-ignore",
      label: "Ignore settings",
      group: "Settings",
      keywords: "folder ignore",
      disabled: busy,
      run: () => setSettingsTab("ignore"),
    },
    {
      id: "open-editor",
      label: "Open in editor",
      group: "Active repo",
      disabled: busy || !hasActive,
      run: () => {
        if (workspace.activePath) {
          void workspace.openInEditor(workspace.activePath, "default");
        }
      },
    },
    {
      id: "open-terminal",
      label: "Open in terminal",
      group: "Active repo",
      disabled: busy || !hasActive,
      run: () => {
        if (workspace.activePath) {
          void workspace.openInTerminal(workspace.activePath);
        }
      },
    },
    {
      id: "reveal-explorer",
      label: "Reveal in Explorer",
      group: "Active repo",
      keywords: "folder show",
      disabled: busy || !hasActive,
      run: () => {
        if (workspace.activePath) {
          void workspace.revealInExplorer(workspace.activePath);
        }
      },
    },
    ...([1, 2, 3] as const).flatMap((slot) => {
      const prompt = workspace.commitPrompts[slot - 1]?.trim();
      if (!prompt) {
        return [];
      }
      return [
        {
          id: `ai-prompt-${slot}`,
          label: `AI commit with prompt ${slot}`,
          group: "AI" as const,
          keywords: prompt,
          disabled: busy || workspace.generating || !hasRepos,
          run: () => workspace.startAiForDirty(slot),
        },
      ];
    }),
  ];
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
        showLabels={workspace.toolbarLabels}
        onOpenAppSettings={() => setSettingsTab("app")}
        onChooseFolder={() => void workspace.chooseFolder()}
        onRefresh={() => void workspace.refresh()}
        onAiCommitPrompt={workspace.startAiForDirty}
        onAddRoot={() => void workspace.addRootFolder()}
        onCreateNewRepo={() => setCreateRepoOpen(true)}
        onCloneRepo={() => setCloneRepoOpen(true)}
        onCommitClear={() => setPendingAction("clear")}
        onAdvancedSearch={() => setAdvancedSearchOpen(true)}
        onOpenCommands={() => setCommandsOpen(true)}
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
          onSelect={workspace.selectRepo}
          onSelectRepos={workspace.selectRepos}
          selectedCount={workspace.selectedPaths.length}
          onPullSelected={() => void workspace.pullSelected()}
          onPushSelected={workspace.requestPushSelected}
          onClearSelection={workspace.clearSelection}
          busy={busy}
          removedRepos={workspace.removedRepos}
          onOpenInEditor={(path, editor) => void workspace.openInEditor(path, editor)}
          onOpenInTerminal={(path) => void workspace.openInTerminal(path)}
          onRevealInExplorer={(path) => void workspace.revealInExplorer(path)}
          onRemoveRepo={(path) => void workspace.removeRepo(path)}
          onDeleteFolder={(path) => void workspace.deleteFolder(path)}
          onRestoreRemoved={() => void workspace.restoreRemoved()}
          repoCount={workspace.repos.length}
          pullCount={pullCount}
          pushCount={pushCount}
          onPullAll={workspace.requestPullAll}
          onPushAll={workspace.requestPushAll}
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
          onPull={workspace.requestPullActive}
          onPush={workspace.requestPushActive}
          onPublish={workspace.publishActive}
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
      {cloneRepoOpen ? (
        <CloneRepoDialog
          defaultParent={workspace.rootPaths[0] ?? ""}
          onClose={() => setCloneRepoOpen(false)}
          onClone={workspace.cloneRepo}
        />
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
      <CommandPalette open={commandsOpen} commands={commands} onOpenChange={setCommandsOpen} />
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
