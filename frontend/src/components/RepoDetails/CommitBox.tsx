import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../Button";
import { AiPrompts } from "../../../../types/git";

type CommitBoxProps = {
  message: string;
  description: string;
  prompts: AiPrompts;
  selectedPrompt: number;
  dirty: boolean;
  busy: boolean;
  generating: boolean;
  openaiReady: boolean | null;
  onChange: (message: string) => void;
  onDescription: (description: string) => void;
  onPrompt: (slot: number) => void;
  onGenerate: () => void;
  onCommit: () => void;
};

const PROMPT_SLOTS = [1, 2, 3] as const;

export function CommitBox({
  message,
  description,
  prompts,
  selectedPrompt,
  dirty,
  busy,
  generating,
  openaiReady,
  onChange,
  onDescription,
  onPrompt,
  onGenerate,
  onCommit,
}: CommitBoxProps) {
  const locked = !dirty || busy;
  const filledPrompts = PROMPT_SLOTS.filter((slot) => prompts[slot - 1]?.trim());
  const [collapsed, setCollapsed] = useState(false);

  return (
    <form
      id="commit-box"
      className="border-t border-zinc-800 bg-zinc-950 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!collapsed) onCommit();
      }}
    >
      <div id="commit-box-header" className={`flex items-center justify-between gap-2 ${collapsed ? "" : "mb-1"}`}>
        <label id="commit-message-label" htmlFor="commit-message" className="block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Commit message
        </label>
        <button
          id="commit-box-toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-controls="commit-box-body"
          title={collapsed ? "Expand commit box" : "Collapse commit box"}
          onClick={() => setCollapsed((open) => !open)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ChevronDown
            id="commit-box-toggle-icon"
            className={`size-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
      </div>
      {collapsed ? null : (
      <div id="commit-box-body">
      <textarea
        id="commit-message"
        value={message}
        onChange={(event) => onChange(event.target.value)}
        placeholder={dirty ? "type: summary" : "Working tree clean"}
        disabled={locked}
        rows={2}
        className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
      />
      <label id="commit-description-label" htmlFor="commit-description" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Description
      </label>
      <textarea
        id="commit-description"
        value={description}
        onChange={(event) => onDescription(event.target.value)}
        placeholder={dirty ? "What changed and why" : "Working tree clean"}
        disabled={locked}
        rows={4}
        className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
      />
      <div id="commit-actions" className="mt-2 flex flex-wrap items-center gap-2">
        <p id="openai-hint" className="mr-auto max-w-sm text-left text-xs text-zinc-500">
          {openaiReady === false
            ? "Add an API key in AI settings."
            : "AI fills the message. Nothing is committed until you press Commit."}
        </p>
        {filledPrompts.length > 0 ? (
          <div id="commit-prompts" className="flex rounded-md border border-zinc-700" role="group" aria-label="Commit prompt">
            {filledPrompts.map((slot, index) => {
              const selected = selectedPrompt === slot;
              const prompt = prompts[slot - 1].trim();
              const edge =
                filledPrompts.length === 1 ? "rounded-md" : index === 0 ? "rounded-l-md" : index === filledPrompts.length - 1 ? "rounded-r-md" : "";
              return (
                <div id={`commit-prompt-wrap-${slot}`} key={slot} className="group relative">
                  <button
                    id={`commit-prompt-${slot}`}
                    type="button"
                    aria-pressed={selected}
                    aria-describedby={`commit-prompt-tooltip-${slot}`}
                    disabled={busy || generating}
                    onClick={() => onPrompt(slot)}
                    className={`h-8 w-8 text-sm ${edge} ${
                      selected ? "bg-violet-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {slot}
                  </button>
                  <div
                    id={`commit-prompt-tooltip-${slot}`}
                    role="tooltip"
                    className="absolute right-0 bottom-full z-30 hidden pb-2 group-hover:block group-focus-within:block"
                  >
                    <p
                      id={`commit-prompt-tooltip-body-${slot}`}
                      className="max-h-48 w-80 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-2 text-left text-xs whitespace-pre-wrap text-zinc-200 shadow-xl"
                    >
                      {prompt}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <Button id="generate-commit" onClick={onGenerate} disabled={locked || generating}>
          <Sparkles id="generate-commit-icon" className="size-4" />
          <span id="generate-commit-label">{generating ? "Generating…" : "Generate with AI"}</span>
        </Button>
        <Button id="commit-button" variant="primary" type="submit" disabled={locked || message.trim().length === 0} className="bg-emerald-600 hover:bg-emerald-500">
          <span id="commit-button-label">Commit</span>
        </Button>
      </div>
      </div>
      )}
    </form>
  );
}
