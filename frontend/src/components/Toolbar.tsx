import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, FolderPlus, FolderRoot, PlusSquare, RefreshCw, Settings, Sparkles, Trash2 } from "lucide-react";
import type { AiPrompts } from "../../../types/git";
import { Button } from "./Button";

type ToolbarProps = {
  rootPaths: string[];
  repoCount: number;
  prompts: AiPrompts;
  busy: boolean;
  generating: boolean;
  discovering: boolean;
  hasSelection: boolean;
  onOpenAppSettings: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onPullAll: () => void;
  onPushAll: () => void;
  onAiCommitPrompt: (slot: number) => void;
  onOpenAiSettings: () => void;
  onOpenGitSettings: () => void;
  onAddRoot: () => void;
  onCreateNewRepo: () => void;
  onCommitClear: () => void;
};

const PROMPT_SLOTS = [1, 2, 3] as const;

export function Toolbar({
  rootPaths,
  repoCount,
  prompts,
  busy,
  generating,
  discovering,
  hasSelection,
  onOpenAppSettings,
  onChooseFolder,
  onRefresh,
  onPullAll,
  onPushAll,
  onAiCommitPrompt,
  onOpenAiSettings,
  onOpenGitSettings,
  onAddRoot,
  onCreateNewRepo,
  onCommitClear,
}: ToolbarProps) {
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [hoveredPrompt, setHoveredPrompt] = useState<number | null>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const filledPrompts = PROMPT_SLOTS.filter((slot) => prompts[slot - 1]?.trim());
  const aiDisabled = busy || generating || repoCount === 0;

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
        <Button id="app-settings-button" onClick={onOpenAppSettings} disabled={busy} title="App settings">
          <Settings id="app-settings-icon" className="size-4" />
        </Button>
        <Button id="choose-folder-button" onClick={onChooseFolder} disabled={busy} title="Open folder as tree">
          <FolderRoot id="choose-folder-icon" className="size-4" />
        </Button>
        <Button id="add-root-button" onClick={onAddRoot} disabled={busy} title="Add folder to existing tree">
          <FolderPlus id="add-root-icon" className="size-4" />
        </Button>
        <Button id="create-repo-button" onClick={onCreateNewRepo} disabled={busy} title="Create a new repo">
          <PlusSquare id="create-repo-icon" className="size-4" />
        </Button>
        <Button id="refresh-button" onClick={onRefresh} disabled={busy || rootPaths.length === 0} title="Refresh repositories">
          <RefreshCw id="refresh-icon" className={`size-4 ${discovering ? "animate-spin" : ""}`} />
        </Button>
        <span id="repo-count" className="shrink-0 text-xs text-zinc-500">
          {discovering ? "Scanning…" : `${repoCount} repos`}
        </span>
      </div>

      <div id="toolbar-center" className="flex items-center gap-2">
        <Button id="commit-clear-button" onClick={onCommitClear} disabled={busy || repoCount === 0} className="border-violet-800 text-violet-200" title="Clear all uncommited commit messages and descriptions">
          <Trash2 id="commit-clear-icon" className="size-4" />
          <span id="commit-clear-label">Clear Commits</span>
        </Button>
        {filledPrompts.length > 1 ? (
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
              className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-violet-700/80 bg-violet-950/40 text-sm font-medium text-violet-100 transition-colors hover:bg-violet-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span id="ai-commit-label" className="inline-flex items-center gap-1.5 px-2.5">
                <Sparkles id="ai-commit-icon" className="size-4" />
                AI commit
              </span>
              <span id="ai-commit-chevron-wrap" className="inline-flex items-center border-l border-violet-700/80 px-1.5">
                <ChevronDown id="ai-commit-chevron" className={`size-4 transition-transform ${promptMenuOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            {promptMenuOpen ? (
              <div
                id="ai-commit-prompt-list"
                role="menu"
                onMouseLeave={() => setHoveredPrompt(null)}
                className="absolute top-full left-0 z-30 mt-1.5 w-36 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-2xl"
              >
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
                          onAiCommitPrompt(slot);
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
                        <p
                          id={`ai-commit-prompt-${slot}-preview`}
                          className="absolute top-0 left-full z-40 ml-2 max-h-56 w-80 overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs leading-5 whitespace-pre-wrap text-zinc-300 shadow-2xl"
                        >
                          {prompts[slot - 1].trim()}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <Button
            id="ai-commit-button"
            onClick={() => onAiCommitPrompt(filledPrompts[0] ?? 1)}
            disabled={aiDisabled}
            className="border-violet-800 text-violet-200"
          >
            <Sparkles id="ai-commit-icon" className="size-4" />
            <span id="ai-commit-label">AI commit</span>
          </Button>
        )}
      </div>


      <div id="toolbar-center" className="flex items-center gap-2">
        <Button
          id="pull-all-button"
          variant="primary"
          onClick={onPullAll}
          disabled={busy || repoCount === 0 || hasSelection}
          title={hasSelection ? "Clear the selection to pull every repository" : undefined}
        >
          <ArrowDownToLine id="pull-all-icon" className="size-4" />
          <span id="pull-all-label">Pull all</span>
        </Button>
        <Button
          id="push-all-button"
          onClick={onPushAll}
          disabled={busy || repoCount === 0 || hasSelection}
          title={hasSelection ? "Clear the selection to push every repository" : undefined}
        >
          <ArrowUpToLine id="push-all-icon" className="size-4" />
          <span id="push-all-label">Push all</span>
        </Button>
      </div>

      <div id="toolbar-right" className="flex items-center gap-2">
        <Button id="git-settings-button" variant="ghost" onClick={onOpenGitSettings}>
          <span id="git-settings-button-label">Git</span>
        </Button>
        <Button id="ai-settings-button" variant="ghost" onClick={onOpenAiSettings}>
          <span id="ai-settings-button-label">AI settings</span>
        </Button>
      </div>

    </header>
  );
}
