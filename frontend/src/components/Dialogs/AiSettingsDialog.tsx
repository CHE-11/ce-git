import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AiPrompts, OpenAiModel, ThinkingMode } from "../../../../types/git";
import { withDefaultPrompts } from "../../lib/commit-prompts";
import { aiSettings, listOpenAiModels, saveAiSettings } from "../../lib/git-client";
import { messageOf } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { Trash2 } from "lucide-react";

const THINKING_MODES: { id: ThinkingMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
];

type AiSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function AiSettingsDialog({ open, onClose, onSaved }: AiSettingsDialogProps) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState<ThinkingMode>("low");
  const [prompts, setPrompts] = useState<AiPrompts>(withDefaultPrompts(undefined));
  const [promptTab, setPromptTab] = useState(0);
  const [models, setModels] = useState<OpenAiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setKey("");
    setLocalError(null);
    setModels([]);
    void (async () => {
      try {
        const settings = await aiSettings();
        if (cancelled) {
          return;
        }
        setConfigured(settings.configured);
        setModel(settings.model);
        setThinking(settings.thinking || "low");
        setPrompts(withDefaultPrompts(settings.prompts));
        if (settings.configured) {
          setLoadingModels(true);
          const listed = await listOpenAiModels("", settings.model);
          if (cancelled) {
            return;
          }
          applyModels(listed, settings.model, setModels, setModel);
        }
      } catch (caught) {
        if (!cancelled) {
          setLocalError(messageOf(caught));
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = () => {
    setKey("");
    setLocalError(null);
    onClose();
  };

  const fetchModels = async () => {
    if (!key.trim() && !configured) {
      setLocalError("Enter an API key first.");
      return;
    }
    setLoadingModels(true);
    setLocalError(null);
    try {
      const listed = await listOpenAiModels(key.trim(), model);
      applyModels(listed, model, setModels, setModel);
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async () => {
    if (!model.trim()) {
      setLocalError("Fetch models and choose one.");
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      await saveAiSettings({ key: key.trim(), model, thinking, prompts, clearKey: false });
      setConfigured(true);
      setKey("");
      onSaved();
      onClose();
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    setLocalError(null);
    try {
      await saveAiSettings({ key: "", model, thinking, prompts, clearKey: true });
      setConfigured(false);
      setModels([]);
      setKey("");
      onSaved();
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog id="ai-settings-dialog" title="AI Settings" open={open} onClose={close}>
      <p id="ai-settings-intro" className="text-sm text-zinc-300">
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
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={configured ? "Saved key" : "sk-..."}
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
        />
        <Button id="ai-fetch-models" onClick={() => void fetchModels()} disabled={loadingModels || saving}>
          <span id="ai-fetch-models-label">{loadingModels ? "Loading…" : "Fetch models"}</span>
        </Button>
      </div>
      <div className="flex justify-between items-center gap-2">
        <div className="flex flex-col w-1/2">
          <label id="ai-model-label" htmlFor="ai-model-select" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Model
          </label>
          <ModelSelect models={models} model={model} loading={loadingModels} onChange={setModel} />
        </div>
        <div className="flex flex-col w-1/2">
          <label id="ai-thinking-label" htmlFor="ai-thinking-select" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Thinking
          </label>
          <select
            id="ai-thinking-select"
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingMode)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
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
                onClick={() => setPromptTab(index)}
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
          onChange={(event) => {
            const value = event.target.value;
            setPrompts((current) => {
              const next: AiPrompts = [...current];
              next[promptTab] = value;
              return next;
            });
          }}
          rows={5}
          placeholder="System prompt for commit messages. Leave blank to skip this slot."
          className="mt-2 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
        />
      </div>


      {localError ? (
        <p id="ai-settings-error" className="mt-2 text-sm text-red-400">
          {localError}
        </p>
      ) : null}
      <div id="ai-settings-actions" className="mt-4 flex justify-between gap-2">
        {configured ? (
          <Button id="ai-clear-key" variant="ghost" onClick={() => void clearKey()} disabled={saving} >   
            <Trash2 id="ai-clear-key-icon" className="size-4 text-red-400 mr-1" />
            <span id="ai-clear-key-label">Clear saved key</span>
          </Button>
        ) : (
          <div className="w-1/2"/>
        )}
        <div className="flex items-center gap-2">
          <Button id="ai-settings-cancel" variant="ghost" onClick={close} disabled={saving}>
            <span id="ai-settings-cancel-label">Cancel</span>
          </Button>
          <Button id="ai-settings-save" variant="primary" onClick={() => void save()} disabled={saving || loadingModels}>
            <span id="ai-settings-save-label">{saving ? "Saving…" : "Save"}</span>
          </Button>
        </div>

      </div>
    </Dialog>
  );
}

function ModelSelect({
  models,
  model,
  loading,
  onChange,
}: {
  models: OpenAiModel[];
  model: string;
  loading: boolean;
  onChange: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBox, setMenuBox] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((item) => item.id === model);
  const disabled = models.length === 0;

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
        disabled={disabled}
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

function applyModels(
  listed: OpenAiModel[],
  current: string,
  setModels: (models: OpenAiModel[]) => void,
  setModel: (model: string) => void,
) {
  setModels(listed);
  if ((!current || !listed.some((item) => item.id === current)) && listed[0]) {
    setModel(listed[0].id);
  }
}

