import { useEffect, useMemo, useRef, useState } from "react";
import type { GitSettings } from "../../../../types/git";
import { gitCancelSignIn, gitSettings, gitSignIn, gitSignOut, saveGitSettings } from "../../lib/git-client";
import { domId, messageOf } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "../Dialog";

const LINE_ENDINGS: { id: string; label: string }[] = [
  { id: "", label: "Keep Git's current default" },
  { id: "true", label: "Windows checkout (CRLF), commit as LF" },
  { id: "input", label: "Commit as LF, leave checkout unchanged" },
  { id: "false", label: "Leave line endings unchanged" },
];

const fieldClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type GitSettingsDialogProps = {
  onClose: () => void;
};

export function GitSettingsDialog({ onClose }: GitSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState(true);
  const [credentialManager, setCredentialManager] = useState(false);
  const [helperConfigured, setHelperConfigured] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [autocrlf, setAutocrlf] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signingInRef = useRef(false);
  const actionRef = useRef(false);
  const mountedRef = useRef(true);

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
      try {
        const settings = await gitSettings();
        if (cancelled) {
          return;
        }
        applyAll(settings);
      } catch (caught) {
        if (!cancelled) {
          setLocalError(messageOf(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lineEndings = useMemo(() => {
    if (autocrlf && !LINE_ENDINGS.some((item) => item.id === autocrlf)) {
      return [...LINE_ENDINGS, { id: autocrlf, label: autocrlf }];
    }
    return LINE_ENDINGS;
  }, [autocrlf]);

  const busy = saving || signingIn || signingOut !== null;

  const requestClose = () => {
    if (saving || signingOut) {
      return;
    }
    if (signingInRef.current) {
      void gitCancelSignIn();
    }
    onClose();
  };

  const signIn = async () => {
    if (actionRef.current) {
      return;
    }
    actionRef.current = true;
    signingInRef.current = true;
    setSigningIn(true);
    setCancelling(false);
    setLocalError(null);
    setNotice(null);
    try {
      const next = await gitSignIn();
      if (!mountedRef.current) {
        return;
      }
      applyAccount(next);
      setNotice(next.accounts.length > 0 ? "Signed in." : "Git Credential Manager closed without a GitHub account.");
    } catch (caught) {
      if (!mountedRef.current) {
        return;
      }
      const message = messageOf(caught);
      if (message.toLowerCase().includes("cancelled")) {
        setNotice("Sign-in was cancelled.");
      } else {
        setLocalError(message);
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
    setLocalError(null);
    setNotice(null);
    try {
      const next = await gitSignOut(account);
      if (!mountedRef.current) {
        return;
      }
      applyAccount(next);
      setNotice("Signed out.");
    } catch (caught) {
      if (mountedRef.current) {
        setLocalError(messageOf(caught));
      }
    } finally {
      actionRef.current = false;
      if (mountedRef.current) {
        setSigningOut(null);
      }
    }
  };

  const save = async () => {
    if (actionRef.current) {
      return;
    }
    if (!name.trim() || !email.trim()) {
      setLocalError("Enter the name and email that should appear on commits.");
      return;
    }
    actionRef.current = true;
    setSaving(true);
    setLocalError(null);
    setNotice(null);
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
        setLocalError(messageOf(caught));
      }
    } finally {
      actionRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  return (
    <Dialog id="git-settings-dialog" title="Git settings" open onClose={requestClose}>
      {loading ? (
        <p id="git-settings-loading" className="text-sm text-zinc-400">
          Loading Git settings…
        </p>
      ) : null}
      {!loading && !gitAvailable ? (
        <p id="git-settings-missing" className="text-sm text-amber-200">
          Install Git and make sure git is on your PATH, then restart ce-git.
        </p>
      ) : null}
      {!loading && gitAvailable ? (
        <form
          id="git-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p id="git-settings-intro" className="text-sm text-zinc-300">
            Sign in to GitHub for pull and push, and set the name and email Git writes on new commits.
          </p>

          <section id="git-account-section" className="mt-4">
            <h3 id="git-account-heading" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Account
            </h3>
            <p id="git-account-status" className="mt-2 text-sm text-zinc-300">
              {accountStatus(credentialManager, helperConfigured, accounts)}
            </p>
            {accounts.length > 0 ? (
              <div id="git-account-list" className="mt-3 flex flex-col gap-2">
                {accounts.map((account) => (
                  <div
                    id={domId("git-account", account)}
                    key={account}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <span id={domId("git-account-name", account)} className="truncate text-sm text-zinc-100">
                      {account}
                    </span>
                    <Button
                      id={domId("git-account-sign-out", account)}
                      variant="ghost"
                      onClick={() => void signOut(account)}
                      disabled={busy}
                    >
                      <span id={domId("git-account-sign-out-label", account)}>
                        {signingOut === account ? "Signing out…" : "Sign out"}
                      </span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {accountsError ? (
              <p id="git-account-error" className="mt-2 text-sm text-red-400">
                {accountsError}
              </p>
            ) : null}
            {credentialManager && !helperConfigured ? (
              <p id="git-helper-hint" className="mt-2 text-xs text-zinc-500">
                Sign-in sets Git Credential Manager as Git's credential helper.
              </p>
            ) : null}
            <div id="git-sign-in-row" className="mt-3 flex flex-wrap items-center gap-2">
              {signingIn ? (
                <>
                  <p id="git-sign-in-status" className="text-sm text-zinc-300">
                    Waiting for Git Credential Manager. Finish in the browser when it opens.
                  </p>
                  <Button id="git-sign-in-cancel" variant="ghost" onClick={cancelSignIn} disabled={cancelling}>
                    <span id="git-sign-in-cancel-label">{cancelling ? "Cancelling…" : "Cancel sign-in"}</span>
                  </Button>
                </>
              ) : (
                <Button
                  id="git-sign-in"
                  variant={accounts.length === 0 ? "primary" : "secondary"}
                  onClick={() => void signIn()}
                  disabled={!credentialManager || busy}
                >
                  <span id="git-sign-in-label">Sign in with GitHub</span>
                </Button>
              )}
            </div>
          </section>

          <section id="git-commits-section" className="mt-5">
            <h3 id="git-commits-heading" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Commits
            </h3>
            <label id="git-name-label" htmlFor="git-name-input" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Name
            </label>
            <input
              id="git-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              disabled={busy}
              placeholder="Your name"
              className={fieldClass}
            />
            <label id="git-email-label" htmlFor="git-email-input" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Email
            </label>
            <input
              id="git-email-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              disabled={busy}
              placeholder="you@example.com"
              className={fieldClass}
            />
            <p id="git-identity-hint" className="mt-1 text-xs text-zinc-500">
              Stored in your global Git config. A repository can keep its own user.name and user.email.
            </p>
          </section>

          <section id="git-defaults-section" className="mt-5">
            <h3 id="git-defaults-heading" className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Defaults
            </h3>
            <label id="git-branch-label" htmlFor="git-branch-input" className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Default branch
            </label>
            <input
              id="git-branch-input"
              value={defaultBranch}
              onChange={(event) => setDefaultBranch(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder="main"
              className={fieldClass}
            />
            <p id="git-branch-hint" className="mt-1 text-xs text-zinc-500">
              Used when Git creates a repository. Leave this blank to keep Git's default. Pull still follows each
              repository's own default branch.
            </p>
            <label
              id="git-line-ending-label"
              htmlFor="git-line-ending-select"
              className="mt-3 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
            >
              Line endings
            </label>
            <select
              id="git-line-ending-select"
              value={autocrlf}
              onChange={(event) => setAutocrlf(event.target.value)}
              disabled={busy}
              className={fieldClass}
            >
              {lineEndings.map((item) => (
                <option id={`git-line-ending-${item.id || "default"}`} key={item.id || "default"} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p id="git-line-ending-hint" className="mt-1 text-xs text-zinc-500">
              Stored in your global Git config as core.autocrlf.
            </p>
          </section>
        </form>
      ) : null}

      {localError ? (
        <p id="git-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {localError}
        </p>
      ) : null}
      {notice ? (
        <p id="git-settings-notice" className="mt-3 text-sm text-zinc-300" role="status">
          {notice}
        </p>
      ) : null}

      <div id="git-settings-actions" className="mt-4 flex justify-end gap-2">
        <Button id="git-settings-cancel" variant="ghost" onClick={requestClose} disabled={saving || signingOut !== null}>
          <span id="git-settings-cancel-label">Cancel</span>
        </Button>
        {!loading && gitAvailable ? (
          <Button id="git-settings-save" type="submit" form="git-settings-form" variant="primary" disabled={busy}>
            <span id="git-settings-save-label">{saving ? "Saving…" : "Save"}</span>
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}

function accountStatus(credentialManager: boolean, helperConfigured: boolean, accounts: string[]) {
  if (!credentialManager) {
    return "Install Git for Windows to sign in with Git Credential Manager, then restart ce-git.";
  }
  if (accounts.length === 0) {
    return helperConfigured
      ? "Sign in to store a GitHub account for HTTPS pull and push."
      : "Sign in to store a GitHub account and set Git Credential Manager as Git's credential helper.";
  }
  return "HTTPS remotes use this account through Git Credential Manager. SSH remotes keep using your SSH keys.";
}
