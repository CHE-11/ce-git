import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, FolderGit2, FolderPlus, FolderRoot, PlusSquare, RefreshCw, Search, Settings, Sparkles, Trash2 } from "lucide-react";
import type { AiPrompts } from "../../../types/git";
import { Button } from "./Button";

type ToolbarProps = {
  rootPaths: string[];
  repoCount: number;
  prompts: AiPrompts;
  busy: boolean;
  generating: boolean;
  discovering: boolean;
  showLabels: boolean;
  onOpenAppSettings: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onAiCommitPrompt: (slot: number) => void;
  onAddRoot: () => void;
  onCreateNewRepo: () => void;
  onCloneRepo: () => void;
  onCommitClear: () => void;
  onAdvancedSearch: () => void;
  onOpenCommands: () => void;
  pullCount: number;
  pushCount: number;
  dirtyCount: number;
  onPullAll: () => void;
  onPushAll: () => void;
};

function syncTitle(action: "pull" | "push", count: number) {
  if (count === 0) {
    return action === "pull" ? "No repositories are behind their upstream" : "No repositories are ahead of their upstream";
  }
  const repos = count === 1 ? "repository is" : "repositories are";
  return action === "pull" ? `${count} ${repos} behind their upstream` : `${count} ${repos} ahead of their upstream`;
}

function SyncBadge({ id, count, tone }: { id: string; count: number; tone: "pull" | "push" | "dirty" }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      id={id}
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ${
        tone === "pull" ? "bg-sky-950 text-sky-100" : tone === "push" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-200"
      }`}
    >
      {count}
    </span>
  );
}

const PROMPT_SLOTS = [1, 2, 3] as const;

function ToolbarIconButton({ id, label, showLabel, children, ...props }: ComponentProps<typeof Button> & { label: string; showLabel: boolean }) {
  return (
    <Button id={id} {...props} className={showLabel ? "h-auto flex-col gap-0.5 px-1.5 py-1" : undefined}>
      {children}
      {showLabel ? (
        <span id={`${id}-label`} className="text-[8px] leading-none font-normal text-zinc-400">
          {label}
        </span>
      ) : null}
    </Button>
  );
}

export function Toolbar({...props}: ToolbarProps) {
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [hoveredPrompt, setHoveredPrompt] = useState<number | null>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const filledPrompts = PROMPT_SLOTS.filter((slot) => props.prompts[slot - 1]?.trim());
  const aiDisabled = props.busy || props.generating || props.repoCount === 0;

  useEffect(() => {
    if (!promptMenuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!promptMenuRef.current?.contains(event.target as Node)) {
        setPromptMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPromptMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [promptMenuOpen]);

  return (
    <header id="toolbar" className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
      <div id="toolbar-left" className="flex items-center gap-2">
        <ToolbarIconButton id="app-settings-button" label="Settings" onClick={props.onOpenAppSettings} disabled={props.busy} title="Settings" showLabel={props.showLabels}>
          <Settings id="app-settings-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="choose-folder-button" label="Open" onClick={props.onChooseFolder} disabled={props.busy} title="Open folder as tree" showLabel={props.showLabels}>
          <FolderRoot id="choose-folder-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="add-root-button" label="Add" onClick={props.onAddRoot} disabled={props.busy} title="Add folder to existing tree" showLabel={props.showLabels}>
          <FolderPlus id="add-root-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="create-repo-button" label="New" onClick={props.onCreateNewRepo} disabled={props.busy} title="Create a new repo" showLabel={props.showLabels}>
          <PlusSquare id="create-repo-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="clone-repo-button" label="Clone" onClick={props.onCloneRepo} disabled={props.busy} title="Clone a repository" showLabel={props.showLabels}>
          <FolderGit2 id="clone-repo-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="advanced-search-button" label="Search" onClick={props.onAdvancedSearch} disabled={props.busy || props.rootPaths.length === 0} title="Advanced search" showLabel={props.showLabels}>
          <Search id="advanced-search-icon" className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton id="refresh-button" label="Refresh" onClick={props.onRefresh} disabled={props.busy || props.rootPaths.length === 0} title="Refresh repositories" showLabel={props.showLabels}>
          <RefreshCw id="refresh-icon" className={`size-4 ${props.discovering ? "animate-spin" : ""}`} />
        </ToolbarIconButton>
        <span id="repo-count" className="shrink-0 text-xs text-zinc-500">
          {props.discovering ? "Scanning…" : `${props.repoCount} repos`}
        </span>
      </div>

      <div id="toolbar-center" className="flex items-center gap-2">
        <Button
          id="pull-all-button"
          variant="primary"
          size="sm"
          onClick={props.onPullAll}
          disabled={props.busy || props.repoCount === 0}
          title={syncTitle("pull", props.pullCount)}
        >
          <ArrowDownToLine id="pull-all-icon" className="size-3.5" />
          <span id="pull-all-label">Pull all</span>
          <SyncBadge id="pull-all-count" count={props.pullCount} tone="pull" />
        </Button>
        <div id="ai-commit-menu" ref={promptMenuRef} className="relative">
          <button
            id="ai-commit-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={promptMenuOpen}
            onClick={() => {
              setHoveredPrompt(null);
              setPromptMenuOpen((open) => !open);
            }}
            disabled={aiDisabled}
            title={
              props.dirtyCount === 0
                ? "No repositories have uncommitted changes"
                : `${props.dirtyCount} ${props.dirtyCount === 1 ? "repository has" : "repositories have"} uncommitted changes`
            }
            className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-violet-700/80 bg-violet-950/40 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span id="ai-commit-label" className="inline-flex items-center gap-1.5 px-2">
              <Sparkles id="ai-commit-icon" className="size-3.5" />
              AI commit
              <SyncBadge id="ai-commit-count" count={props.dirtyCount} tone="dirty" />
            </span>
            <span id="ai-commit-chevron-wrap" className="inline-flex items-center border-l border-violet-700/80 px-2">
              <ChevronDown id="ai-commit-chevron" className={`size-3.5 transition-transform ${promptMenuOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {promptMenuOpen ? (
            <div
              id="ai-commit-prompt-list"
              role="menu"
              onMouseLeave={() => setHoveredPrompt(null)}
              className="absolute top-full right-0 z-30 mt-1.5 w-44 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-2xl"
            >
              <button
                id="commit-clear-button"
                type="button"
                role="menuitem"
                title="Clear all uncommitted commit messages and descriptions"
                onMouseEnter={() => setHoveredPrompt(null)}
                onClick={() => {
                  setHoveredPrompt(null);
                  setPromptMenuOpen(false);
                  props.onCommitClear();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                <span id="commit-clear-label" className="text-red-400 font-semibold">Clear All Commits</span>
              </button>
              {filledPrompts.length > 0 ? (
                <div id="ai-commit-menu-separator" className="mx-1 my-1 h-px bg-zinc-700" /> ) : null}
              {filledPrompts.map((slot) => {
                const active = hoveredPrompt === slot;
                return (
                  <div id={`ai-commit-prompt-${slot}-row`} key={slot} className="relative">
                    <button
                      id={`ai-commit-prompt-${slot}`}
                      type="button"
                      role="menuitem"
                      onMouseEnter={() => setHoveredPrompt(slot)}
                      onFocus={() => setHoveredPrompt(slot)}
                      onClick={() => {
                        setHoveredPrompt(null);
                        setPromptMenuOpen(false);
                        props.onAiCommitPrompt(slot);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                        active ? "bg-violet-600/25 text-zinc-50" : "text-zinc-200 hover:bg-zinc-800"
                      }`}
                    >
                      <span id={`ai-commit-prompt-${slot}-label`}>Prompt {slot}</span>
                      <span id={`ai-commit-prompt-${slot}-number`} className="font-mono text-xs text-zinc-400">
                        {slot}
                      </span>
                    </button>
                    {active ? (
                      <div id={`ai-commit-prompt-${slot}-bridge`} className="absolute top-0 right-full z-40 pr-2">
                        <p
                          id={`ai-commit-prompt-${slot}-preview`}
                          className="max-h-56 w-80 overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs leading-5 whitespace-pre-wrap text-zinc-300 shadow-2xl"
                        >
                          {props.prompts[slot - 1].trim()}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <Button
          id="push-all-button"
          size="sm"
          onClick={props.onPushAll}
          disabled={props.busy || props.repoCount === 0}
          title={syncTitle("push", props.pushCount)}
        >
          <ArrowUpToLine id="push-all-icon" className="size-3.5" />
          <span id="push-all-label">Push all</span>
          <SyncBadge id="push-all-count" count={props.pushCount} tone="push" />
        </Button>
      </div>

      <button
        id="command-palette-button"
        type="button"
        onClick={props.onOpenCommands}
        title="Commands"
        className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <Search id="command-palette-button-icon" className="size-3.5" />
        <kbd id="command-palette-shortcut" className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-500">
          Ctrl + K
        </kbd>
      </button>

    </header>
  );
}
