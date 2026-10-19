import { useMemo } from "react";
import { domId } from "../../../lib/tree";
import { Button } from "../../Button";

const LINE_ENDINGS: { id: string; label: string }[] = [
  { id: "", label: "Keep Git's current default" },
  { id: "true", label: "Windows checkout (CRLF), commit as LF" },
  { id: "input", label: "Commit as LF, leave checkout unchanged" },
  { id: "false", label: "Leave line endings unchanged" },
];

const fieldClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type GitSettingsTabProps = {
  gitAvailable: boolean;
  busy: boolean;
  credentialManager: boolean;
  helperConfigured: boolean;
  accounts: string[];
  accountsError: string | null;
  signingIn: boolean;
  cancelling: boolean;
  signingOut: string | null;
  name: string;
  email: string;
  defaultBranch: string;
  autocrlf: string;
  error: string | null;
  notice: string | null;
  onNameChange: (name: string) => void;
  onEmailChange: (email: string) => void;
  onDefaultBranchChange: (branch: string) => void;
  onAutocrlfChange: (autocrlf: string) => void;
  onSignIn: () => void;
  onCancelSignIn: () => void;
  onSignOut: (account: string) => void;
  onSubmit: () => void;
};

export function GitSettingsTab({
  gitAvailable,
  busy,
  credentialManager,
  helperConfigured,
  accounts,
  accountsError,
  signingIn,
  cancelling,
  signingOut,
  name,
  email,
  defaultBranch,
  autocrlf,
  error,
  notice,
  onNameChange,
  onEmailChange,
  onDefaultBranchChange,
  onAutocrlfChange,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onSubmit,
}: GitSettingsTabProps) {
  const lineEndings = useMemo(() => {
    if (autocrlf && !LINE_ENDINGS.some((item) => item.id === autocrlf)) {
      return [...LINE_ENDINGS, { id: autocrlf, label: autocrlf }];
    }
    return LINE_ENDINGS;
  }, [autocrlf]);

  return (
    <>
      {!gitAvailable ? (
        <p id="settings-panel-git" role="tabpanel" aria-labelledby="settings-tab-git" className="mt-4 text-sm text-amber-200">
          Install Git and make sure git is on your PATH, then restart ce-git.
        </p>
      ) : (
        <form
          id="settings-panel-git"
          role="tabpanel"
          aria-labelledby="settings-tab-git"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <p id="git-settings-intro" className="mt-4 text-sm text-zinc-300">
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
                    <Button id={domId("git-account-sign-out", account)} variant="ghost" onClick={() => onSignOut(account)} disabled={busy}>
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
                  <Button id="git-sign-in-cancel" variant="ghost" onClick={onCancelSignIn} disabled={cancelling}>
                    <span id="git-sign-in-cancel-label">{cancelling ? "Cancelling…" : "Cancel sign-in"}</span>
                  </Button>
                </>
              ) : (
                <Button
                  id="git-sign-in"
                  variant={accounts.length === 0 ? "primary" : "secondary"}
                  onClick={onSignIn}
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
              onChange={(event) => onNameChange(event.target.value)}
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
              onChange={(event) => onEmailChange(event.target.value)}
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
              onChange={(event) => onDefaultBranchChange(event.target.value)}
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
              onChange={(event) => onAutocrlfChange(event.target.value)}
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
      )}
      {error ? (
        <p id="git-settings-error" className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p id="git-settings-notice" className="mt-3 text-sm text-zinc-300" role="status">
          {notice}
        </p>
      ) : null}
    </>
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
