import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AiPrompts, OpenAiModel, ThinkingMode } from "../../../../../types/git";
import { Button } from "../../Button";

const THINKING_MODES: { id: ThinkingMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
];

type AISettingsTabProps = {
  busy: boolean;
  loadingModels: boolean;
  configured: boolean;
  apiKey: string;
  model: string;
  thinking: ThinkingMode;
  prompts: AiPrompts;
  promptTab: number;
  models: OpenAiModel[];
  error: string | null;
  onApiKeyChange: (key: string) => void;
  onModelChange: (model: string) => void;
  onThinkingChange: (thinking: ThinkingMode) => void;
  onPromptTabChange: (index: number) => void;
  onPromptChange: (index: number, value: string) => void;
  onFetchModels: () => void;
  onSubmit: () => void;
};

export function AISettingsTab({
  busy,
  loadingModels,
  configured,
  apiKey,
  model,
  thinking,
  prompts,
  promptTab,
  models,
  error,
  onApiKeyChange,
  onModelChange,
  onThinkingChange,
  onPromptTabChange,
  onPromptChange,
  onFetchModels,
  onSubmit,
}: AISettingsTabProps) {
  return (
    <>
      <form
        id="settings-panel-ai"
        role="tabpanel"
        aria-labelledby="settings-tab-ai"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <p id="ai-settings-intro" className="mt-4 text-sm text-zinc-300">
          {configured
            ? "A key is saved in this computer's credential manager. Paste a new one only when you want to replace it."
            : "Paste an OpenAI API key. It is saved in this computer's credential manager."}
        </p>
        <label id="ai-key-label" htmlFor="ai-key-input" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          API key
        </label>
        <div id="ai-key-row" className="flex gap-2">
          <input
            id="ai-key-input"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={configured ? "Saved key" : "sk-..."}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
          />
          <Button id="ai-fetch-models" onClick={onFetchModels} disabled={loadingModels || busy}>
            <span id="ai-fetch-models-label">{loadingModels ? "Loading…" : "Fetch models"}</span>
          </Button>
        </div>
        <div id="ai-model-thinking-row" className="flex items-start justify-between gap-2">
          <div id="ai-model-column" className="flex w-1/2 flex-col">
            <label id="ai-model-label" htmlFor="ai-model-select" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Model
            </label>
            <ModelSelect models={models} model={model} loading={loadingModels} disabled={busy} onChange={onModelChange} />
          </div>
          <div id="ai-thinking-column" className="flex w-1/2 flex-col">
            <label id="ai-thinking-label" htmlFor="ai-thinking-select" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Thinking
            </label>
            <select
              id="ai-thinking-select"
              value={thinking}
              disabled={busy}
              onChange={(event) => onThinkingChange(event.target.value as ThinkingMode)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
            >
              {THINKING_MODES.map((mode) => (
                <option id={`ai-thinking-${mode.id}`} key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div id="ai-prompts" className="mt-4">
          <p id="ai-prompts-label" className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            AI prompts
          </p>
          <div id="ai-prompt-tabs" className="flex overflow-hidden rounded-md border border-zinc-700" role="tablist" aria-label="AI prompts">
            {prompts.map((_, index) => {
              const selected = promptTab === index;
              return (
                <button
                  id={`ai-prompt-tab-${index + 1}`}
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="ai-prompt-input"
                  onClick={() => onPromptTabChange(index)}
                  className={`h-8 flex-1 text-sm ${selected ? "bg-violet-600 text-white" : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <textarea
            id="ai-prompt-input"
            role="tabpanel"
            value={prompts[promptTab]}
            disabled={busy}
            onChange={(event) => onPromptChange(promptTab, event.target.value)}
            rows={5}
            placeholder="System prompt for commit messages. Leave blank to skip this slot."
            className="mt-2 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
          />
        </div>
      </form>
      {error ? (
        <p id="ai-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function ModelSelect({
  models,
  model,
  loading,
  disabled,
  onChange,
}: {
  models: OpenAiModel[];
  model: string;
  loading: boolean;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBox, setMenuBox] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((item) => item.id === model);
  const unavailable = models.length === 0 || disabled;

  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenuBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    placeMenu();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (buttonRef.current?.contains(target) || document.getElementById("ai-model-menu")?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);

  return (
    <div id="ai-model-field">
      <button
        id="ai-model-select"
        ref={buttonRef}
        type="button"
        disabled={unavailable}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
      >
        <span id="ai-model-select-label" className="min-w-0 truncate">
          {selected ? selected.id : loading ? "Loading models…" : "Fetch models to choose one"}
        </span>
        {selected ? (
          <span id="ai-model-select-price" className="shrink-0 font-mono text-zinc-400">
            {selected.price}
          </span>
        ) : null}
      </button>
      {menuOpen
        ? createPortal(
            <ul
              id="ai-model-menu"
              role="listbox"
              aria-labelledby="ai-model-label"
              style={{ position: "fixed", top: menuBox.top, left: menuBox.left, width: menuBox.width }}
              className="z-50 max-h-64 overflow-auto rounded-md border border-zinc-700 bg-zinc-950 py-1 shadow-xl"
            >
              {models.map((item) => {
                const active = item.id === model;
                return (
                  <li id={`ai-model-${item.id}-row`} key={item.id} role="presentation">
                    <button
                      id={`ai-model-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(item.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                        active ? "bg-violet-600/30 text-zinc-50" : "text-zinc-100 hover:bg-zinc-800"
                      }`}
                    >
                      <span id={`ai-model-${item.id}-name`} className="min-w-0 truncate">
                        {item.id}
                      </span>
                      <span id={`ai-model-${item.id}-price`} className="shrink-0 font-mono text-zinc-400">
                        {item.price}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
