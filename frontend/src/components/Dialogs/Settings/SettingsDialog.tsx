import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiPrompts, AppSettings, GitSettings, OpenAiModel, ThinkingMode } from "../../../../../types/git";
import {
  applyAppearance,
  normalizeColorMode,
  normalizeTheme,
  readAppearance,
  type ColorMode,
  type ThemeId,
} from "../../../lib/appearance";
import { cn } from "../../../lib/cn";
import { withDefaultPrompts } from "../../../lib/commit-prompts";
import {
  aiSettings,
  appSettings,
  gitCancelSignIn,
  gitSettings,
  gitSignIn,
  gitSignOut,
  listOpenAiModels,
  saveAiSettings,
  saveAppSettings,
  saveGitSettings,
} from "../../../lib/git-client";
import { messageOf } from "../../../lib/tree";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, readZoom } from "../../../lib/zoom";
import { Button } from "../../Button";
import { Dialog } from "../Dialog";
import { AISettingsTab } from "./AISettingsTab";
import { AppSettingsTab } from "./AppSettingsTab";
import { GitSettingsTab } from "./GitSettingsTab";

const SETTINGS_TABS = [
  { id: "app", label: "App" },
  { id: "git", label: "Git" },
  { id: "ai", label: "AI" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

type AppSettingsDialogProps = {
  selectedPrompt: number;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  onAiSaved: () => void;
};

export function SettingsDialog({ selectedPrompt, initialTab = "app", onClose, onSaved, onAiSaved }: AppSettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folder, setFolder] = useState("");
  const [zoom, setZoom] = useState(readZoom);
  const openedAppearance = useRef(readAppearance());
  const [theme, setTheme] = useState<ThemeId>(openedAppearance.current.theme);
  const [colorMode, setColorMode] = useState<ColorMode>(openedAppearance.current.colorMode);
  const [warning, setWarning] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);

  const [gitAvailable, setGitAvailable] = useState(true);
  const [credentialManager, setCredentialManager] = useState(false);
  const [helperConfigured, setHelperConfigured] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [autocrlf, setAutocrlf] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const signingInRef = useRef(false);
  const actionRef = useRef(false);
  const mountedRef = useRef(true);

  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState<ThinkingMode>("low");
  const [prompts, setPrompts] = useState<AiPrompts>(withDefaultPrompts(undefined));
  const [promptTab, setPromptTab] = useState(0);
  const [models, setModels] = useState<OpenAiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (signingInRef.current) {
        void gitCancelSignIn();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [appResult, gitResult, aiResult] = await Promise.allSettled([appSettings(), gitSettings(), aiSettings()]);
      if (cancelled) {
        return;
      }

      if (appResult.status === "fulfilled") {
        const settings = appResult.value;
        setFolder(settings.settingsFolder);
        setWarning(settings.warning);
        setPrompts(withDefaultPrompts(settings.prompts));
        const appearance = settings.shared
          ? {
              theme: normalizeTheme(settings.theme),
              colorMode: normalizeColorMode(settings.colorMode),
            }
          : readAppearance();
        openedAppearance.current = appearance;
        setTheme(appearance.theme);
        setColorMode(appearance.colorMode);
        if (settings.shared) {
          setZoom(clampDialogZoom(settings.fontZoom));
          applyAppearance(appearance.theme, appearance.colorMode);
        }
      } else {
        setAppError(messageOf(appResult.reason));
      }

      if (gitResult.status === "fulfilled") {
        applyAll(gitResult.value);
      } else {
        setGitError(messageOf(gitResult.reason));
      }

      if (aiResult.status === "fulfilled") {
        const settings = aiResult.value;
        setConfigured(settings.configured);
        setModel(settings.model);
        setThinking(settings.thinking || "low");
        setPrompts(withDefaultPrompts(settings.prompts));
        if (settings.configured) {
          setLoadingModels(true);
          try {
            const listed = await listOpenAiModels("", settings.model);
            if (!cancelled) {
              applyModels(listed, settings.model, setModels, setModel);
            }
          } catch (caught) {
            if (!cancelled) {
              setAiError(messageOf(caught));
            }
          } finally {
            if (!cancelled) {
              setLoadingModels(false);
            }
          }
        }
      } else {
        setAiError(messageOf(aiResult.reason));
      }

      if (!cancelled) {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyAccount = (settings: GitSettings) => {
    setGitAvailable(settings.gitAvailable);
    setCredentialManager(settings.credentialManager);
    setHelperConfigured(settings.helperConfigured);
    setAccounts(settings.accounts);
    setAccountsError(settings.accountsError);
  };

  const applyAll = (settings: GitSettings) => {
    applyAccount(settings);
    setName(settings.name);
    setEmail(settings.email);
    setDefaultBranch(settings.defaultBranch);
    setAutocrlf(settings.autocrlf);
  };

  const busy = saving || signingIn || signingOut !== null;

  const requestClose = () => {
    if (saving || signingOut) {
      return;
    }
    if (signingInRef.current) {
      void gitCancelSignIn();
    }
    applyAppearance(openedAppearance.current.theme, openedAppearance.current.colorMode);
    onClose();
  };

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    applyAppearance(next, colorMode);
  };

  const chooseColorMode = (next: ColorMode) => {
    setColorMode(next);
    applyAppearance(theme, next);
  };

  const browse = async () => {
    setAppError(null);
    try {
      const picked = await openFolder({
        directory: true,
        multiple: false,
        title: "Choose the settings folder",
        defaultPath: folder.trim() || undefined,
      });
      if (typeof picked === "string") {
        setFolder(picked);
        setWarning(null);
      }
    } catch (caught) {
      setAppError(messageOf(caught));
    }
  };

  const saveApp = async () => {
    setSaving(true);
    setAppError(null);
    try {
      const saved = await saveAppSettings({
        settingsFolder: folder.trim(),
        fontZoom: zoom,
        theme,
        colorMode,
        selectedPrompt,
        prompts,
      });
      onSaved(saved);
      onClose();
    } catch (caught) {
      setAppError(messageOf(caught));
      setSaving(false);
    }
  };

  const signIn = async () => {
    if (actionRef.current) {
      return;
    }
    actionRef.current = true;
    signingInRef.current = true;
    setSigningIn(true);
    setCancelling(false);
    setGitError(null);
    setGitNotice(null);
    try {
      const next = await gitSignIn();
      if (!mountedRef.current) {
        return;
      }
      applyAccount(next);
      setGitNotice(next.accounts.length > 0 ? "Signed in." : "Git Credential Manager closed without a GitHub account.");
    } catch (caught) {
      if (!mountedRef.current) {
        return;
      }
      const message = messageOf(caught);
      if (message.toLowerCase().includes("cancelled")) {
        setGitNotice("Sign-in was cancelled.");
      } else {
        setGitError(message);
      }
    } finally {
      signingInRef.current = false;
      actionRef.current = false;
      if (mountedRef.current) {
        setSigningIn(false);
        setCancelling(false);
      }
    }
  };

  const cancelSignIn = () => {
    setCancelling(true);
    void gitCancelSignIn();
  };

  const signOut = async (account: string) => {
    if (actionRef.current) {
      return;
    }
    actionRef.current = true;
    setSigningOut(account);
    setGitError(null);
    setGitNotice(null);
    try {
      const next = await gitSignOut(account);
      if (!mountedRef.current) {
        return;
      }
      applyAccount(next);
      setGitNotice("Signed out.");
    } catch (caught) {
      if (mountedRef.current) {
        setGitError(messageOf(caught));
      }
    } finally {
      actionRef.current = false;
      if (mountedRef.current) {
        setSigningOut(null);
      }
    }
  };

  const saveGit = async () => {
    if (actionRef.current) {
      return;
    }
    if (!name.trim() || !email.trim()) {
      setGitError("Enter the name and email that should appear on commits.");
      return;
    }
    actionRef.current = true;
    setSaving(true);
    setGitError(null);
    setGitNotice(null);
    try {
      await saveGitSettings({
        name: name.trim(),
        email: email.trim(),
        defaultBranch: defaultBranch.trim(),
        autocrlf,
      });
      if (mountedRef.current) {
        onClose();
      }
    } catch (caught) {
      if (mountedRef.current) {
        setGitError(messageOf(caught));
      }
    } finally {
      actionRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  const fetchModels = async () => {
    if (!key.trim() && !configured) {
      setAiError("Enter an API key first.");
      return;
    }
    setLoadingModels(true);
    setAiError(null);
    try {
      const listed = await listOpenAiModels(key.trim(), model);
      applyModels(listed, model, setModels, setModel);
    } catch (caught) {
      setAiError(messageOf(caught));
    } finally {
      setLoadingModels(false);
    }
  };

  const saveAi = async () => {
    if (!model.trim()) {
      setAiError("Fetch models and choose one.");
      return;
    }
    setSaving(true);
    setAiError(null);
    try {
      await saveAiSettings({ key: key.trim(), model, thinking, prompts, clearKey: false });
      setConfigured(true);
      setKey("");
      onAiSaved();
      onClose();
    } catch (caught) {
      setAiError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    setAiError(null);
    try {
      await saveAiSettings({ key: "", model, thinking, prompts, clearKey: true });
      setConfigured(false);
      setModels([]);
      setKey("");
      onAiSaved();
    } catch (caught) {
      setAiError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const showSave = !loading && (tab !== "git" || gitAvailable);

  return (
    <Dialog id="app-settings-dialog" title="Settings" open onClose={requestClose}>
      <div id="settings-tabs" className="flex overflow-hidden rounded-md border border-zinc-700" role="tablist" aria-label="Settings">
        {SETTINGS_TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              id={`settings-tab-${item.id}`}
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              onClick={() => setTab(item.id)}
              className={cn("h-8 flex-1 text-sm", selected ? "bg-sky-600 text-white" : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800")}
            >
              <span id={`settings-tab-${item.id}-label`}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p id="app-settings-loading" className="mt-4 text-sm text-zinc-400">
          Loading settings…
        </p>
      ) : null}

      {!loading && tab === "app" ? (
        <AppSettingsTab
          busy={busy}
          folder={folder}
          zoom={zoom}
          theme={theme}
          colorMode={colorMode}
          warning={warning}
          error={appError}
          onFolderChange={(value) => {
            setFolder(value);
            setWarning(null);
            setAppError(null);
          }}
          onZoomChange={(value) => setZoom(clampDialogZoom(value))}
          onThemeChange={chooseTheme}
          onColorModeChange={chooseColorMode}
          onBrowse={() => void browse()}
          onClearFolder={() => {
            setFolder("");
            setWarning(null);
            setAppError(null);
          }}
          onSubmit={() => void saveApp()}
        />
      ) : null}

      {!loading && tab === "git" ? (
        <GitSettingsTab
          gitAvailable={gitAvailable}
          busy={busy}
          credentialManager={credentialManager}
          helperConfigured={helperConfigured}
          accounts={accounts}
          accountsError={accountsError}
          signingIn={signingIn}
          cancelling={cancelling}
          signingOut={signingOut}
          name={name}
          email={email}
          defaultBranch={defaultBranch}
          autocrlf={autocrlf}
          error={gitError}
          notice={gitNotice}
          onNameChange={setName}
          onEmailChange={setEmail}
          onDefaultBranchChange={setDefaultBranch}
          onAutocrlfChange={setAutocrlf}
          onSignIn={() => void signIn()}
          onCancelSignIn={cancelSignIn}
          onSignOut={(account) => void signOut(account)}
          onSubmit={() => void saveGit()}
        />
      ) : null}

      {!loading && tab === "ai" ? (
        <AISettingsTab
          busy={busy}
          loadingModels={loadingModels}
          configured={configured}
          apiKey={key}
          model={model}
          thinking={thinking}
          prompts={prompts}
          promptTab={promptTab}
          models={models}
          error={aiError}
          onApiKeyChange={setKey}
          onModelChange={setModel}
          onThinkingChange={setThinking}
          onPromptTabChange={setPromptTab}
          onPromptChange={(index, value) => {
            setPrompts((current) => {
              const next: AiPrompts = [...current];
              next[index] = value;
              return next;
            });
          }}
          onFetchModels={() => void fetchModels()}
          onSubmit={() => void saveAi()}
        />
      ) : null}


      <div id="app-settings-actions" className="mt-4 flex justify-between gap-2">
        <div id="app-settings-actions-start">
          {!loading && tab === "ai" && configured ? (
            <Button id="ai-clear-key" variant="ghost" onClick={() => void clearKey()} disabled={saving}>
              <Trash2 id="ai-clear-key-icon" className="mr-1 size-4 text-red-400" />
              <span id="ai-clear-key-label">Clear saved key</span>
            </Button>
          ) : null}
        </div>
        <div id="app-settings-actions-end" className="flex items-center gap-2">
          <Button id="app-settings-cancel" variant="ghost" onClick={requestClose} disabled={saving || signingOut !== null}>
            <span id="app-settings-cancel-label">Cancel</span>
          </Button>
          {showSave ? (
            <Button id="app-settings-save" type="submit" form={panelId(tab)} variant="primary" disabled={busy || (tab === "ai" && loadingModels)}>
              <span id="app-settings-save-label">{saving ? "Saving…" : "Save"}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
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

function clampDialogZoom(value: number) {
  if (!Number.isFinite(value)) {
    return readZoom();
  }
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

function panelId(tab: SettingsTab) {
  return `settings-panel-${tab}`;
}
