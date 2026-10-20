import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderGit2, FolderPlus, FolderRoot, PlusSquare, RefreshCw, Search, Settings, Sparkles, Trash2 } from "lucide-react";
import type { AiPrompts } from "../../../types/git";
import { Button } from "./Button";

type ToolbarProps = {
  rootPaths: string[];
  repoCount: number;
  prompts: AiPrompts;
  busy: boolean;
  generating: boolean;
  discovering: boolean;
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
};

const PROMPT_SLOTS = [1, 2, 3] as const;

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
        <Button id="app-settings-button" onClick={props.onOpenAppSettings} disabled={props.busy} title="Settings">
          <Settings id="app-settings-icon" className="size-4" />
        </Button>
        <Button id="choose-folder-button" onClick={props.onChooseFolder} disabled={props.busy} title="Open folder as tree">
          <FolderRoot id="choose-folder-icon" className="size-4" />
        </Button>
        <Button id="add-root-button" onClick={props.onAddRoot} disabled={props.busy} title="Add folder to existing tree">
          <FolderPlus id="add-root-icon" className="size-4" />
        </Button>
        <Button id="create-repo-button" onClick={props.onCreateNewRepo} disabled={props.busy} title="Create a new repo">
          <PlusSquare id="create-repo-icon" className="size-4" />
        </Button>
        <Button id="clone-repo-button" onClick={props.onCloneRepo} disabled={props.busy} title="Clone a repository">
          <FolderGit2 id="clone-repo-icon" className="size-4" />
        </Button>
        <Button id="advanced-search-button" onClick={props.onAdvancedSearch} disabled={props.busy || props.rootPaths.length === 0} title="Advanced search">
          <Search id="advanced-search-icon" className="size-4" />
        </Button>
        <Button id="refresh-button" onClick={props.onRefresh} disabled={props.busy || props.rootPaths.length === 0} title="Refresh repositories">
          <RefreshCw id="refresh-icon" className={`size-4 ${props.discovering ? "animate-spin" : ""}`} />
        </Button>
        <span id="repo-count" className="shrink-0 text-xs text-zinc-500">
          {props.discovering ? "Scanning…" : `${props.repoCount} repos`}
        </span>
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

      <div id="toolbar-right" className="flex items-center gap-2">
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
                <Trash2 id="commit-clear-icon" className="size-3.5 text-red-400" />
                <span id="commit-clear-label">Clear Commits</span>
              </button>
              {filledPrompts.length > 0 ? (
                <div id="ai-commit-menu-separator" className="mx-1 my-1 h-px bg-zinc-700" />
              ) : null}
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
      </div>


    </header>
  );
}
