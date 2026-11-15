import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubGist, TreeNode } from "../../../../types/git";
import { listGithubGists } from "../../lib/git-client";
import { collectRepos, messageOf, pickedFolderPath } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type CloneGistDialogProps = {
  trees?: TreeNode[];
  defaultParent?: string;
  onClose: () => void;
  onClone: (url: string, destination: string) => Promise<void>;
  onOpenRepo: () => void;
};

function folderNameFromUrl(url: string) {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const withoutGit = trimmed.replace(/\.git$/i, "");
  const segment = withoutGit.split(/[/:]/).pop()?.trim() ?? "";
  if (!segment || segment === "." || segment === "..") {
    return "";
  }
  if (/[<>:"/\\|?*]/.test(segment) || segment.startsWith("-")) {
    return "";
  }
  return segment;
}

function joinPath(parent: string, name: string) {
  const base = parent.trim().replace(/[\\/]+$/, "");
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${name.trim()}`;
}

function gistDomId(id: string) {
  const slug = id.replace(/[^A-Za-z0-9._-]/g, "");
  return `clone-gist-${slug || "gist"}`;
}

function accountDomId(account: string) {
  const slug = account.replace(/[^A-Za-z0-9._-]/g, "");
  return `clone-gist-account-${slug || "account"}`;
}

export function CloneGistDialog({ trees = [], defaultParent = "", onClose, onClone, onOpenRepo }: CloneGistDialogProps) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(defaultParent);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [gists, setGists] = useState<GithubGist[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingGists, setLoadingGists] = useState(true);
  const [filter, setFilter] = useState("");
  const [hideExisting, setHideExisting] = useState(true);
  const requestRef = useRef(0);
  const nameEditedRef = useRef(false);

  const applySelection = (next: string, folder?: string) => {
    setUrl(next);
    setError(null);
    if (!nameEditedRef.current) {
      setName(folder ?? folderNameFromUrl(next));
    }
  };

  const loadList = (requested: string) => {
    const id = ++requestRef.current;
    setLoadingGists(true);
    setListError(null);
    setNotice(null);
    setTruncated(false);
    setGists([]);
    listGithubGists(requested).then(
      (page) => {
        if (requestRef.current !== id) {
          return;
        }
        setAccounts(page.accounts);
        setGists(page.gists);
        setTruncated(page.truncated);
        setNotice(page.notice);
        if (requested === "" && page.account) {
          setAccount(page.account);
        }
        setLoadingGists(false);
      },
      (caught) => {
        if (requestRef.current !== id) {
          return;
        }
        setGists([]);
        setTruncated(false);
        setNotice(null);
        setListError(messageOf(caught));
        setLoadingGists(false);
      },
    );
  };

  useEffect(() => {
    loadList("");
    return () => {
      requestRef.current += 1;
    };
  }, []);

  const requestClose = () => {
    if (cloning) {
      return;
    }
    onClose();
  };

  const browse = async () => {
    setError(null);
    try {
      const picked = await openFolder({
        directory: true,
        multiple: false,
        title: "Choose a folder to clone into",
        defaultPath: parent.trim() || undefined,
      });
      const path = pickedFolderPath(picked);
      if (path) {
        setParent(path);
      }
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const clone = async () => {
    const remote = url.trim();
    const folder = parent.trim();
    const folderName = name.trim();
    if (!remote) {
      setError("Choose a gist or enter a URL.");
      return;
    }
    if (!folder) {
      setError("Choose a parent folder.");
      return;
    }
    if (!folderName || folderName === "." || folderName === ".." || /[\\/:*?"<>|]/.test(folderName)) {
      setError("Enter a folder name without path separators.");
      return;
    }
    setCloning(true);
    setError(null);
    try {
      await onClone(remote, joinPath(folder, folderName));
      onClose();
    } catch (caught) {
      setError(messageOf(caught));
      setCloning(false);
    }
  };

  const existingNames = useMemo(() => {
    const names = new Set<string>();
    for (const tree of trees) {
      for (const repo of collectRepos(tree)) {
        names.add(repo.name.toLowerCase());
      }
    }
    return names;
  }, [trees]);
  const query = filter.trim().toLowerCase();
  const inTree = (gist: GithubGist) =>
    existingNames.has(gist.folder.toLowerCase()) || existingNames.has(gist.id.toLowerCase());
  const hiddenCount = gists.filter(inTree).length;
  const available = hideExisting ? gists.filter((gist) => !inTree(gist)) : gists;
  const visible = query
    ? available.filter(
        (gist) =>
          gist.name.toLowerCase().includes(query) ||
          gist.description.toLowerCase().includes(query) ||
          gist.id.toLowerCase().includes(query),
      )
    : available;
  const canSubmit = url.trim().length > 0 && parent.trim().length > 0 && name.trim().length > 0;
  const showPicker = accounts.length > 0;

  return (
    <Dialog id="clone-gist-dialog" title="Clone gist" open onClose={requestClose}>
      <form
        id="clone-gist-form"
        onSubmit={(event) => {
          event.preventDefault();
          void clone();
        }}
      >
        <p id="clone-gist-copy" className="text-sm text-zinc-300">
          Choose a gist from a signed-in GitHub account, or paste a gist URL. If the new folder is not already under an
          open workspace folder, it is added to the tree.
        </p>
        <div id="clone-gist-switch" className="mt-2">
          <Button id="clone-gist-open-repo" variant="link" disabled={cloning} onClick={onOpenRepo}>
            <span id="clone-gist-open-repo-label">Clone a repository instead</span>
          </Button>
        </div>
        {loadingGists && !showPicker && !listError ? (
          <p id="clone-gist-loading" className="mt-4 text-sm text-zinc-400">
            Loading gists…
          </p>
        ) : null}
        {listError && !showPicker ? (
          <p id="clone-gist-list-error" className="mt-4 text-sm text-red-400">
            {listError}
          </p>
        ) : null}
        {accounts.length > 1 ? (
          <label
            id="clone-gist-account-label"
            htmlFor="clone-gist-account-select"
            className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
          >
            GitHub account
          </label>
        ) : null}
        {accounts.length > 1 ? (
          <select
            id="clone-gist-account-select"
            value={account}
            disabled={cloning || loadingGists}
            onChange={(event) => {
              const next = event.target.value;
              setAccount(next);
              setFilter("");
              loadList(next);
            }}
            className={`${fieldClass} w-full`}
          >
            {accounts.map((item) => (
              <option id={accountDomId(item)} key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        ) : null}
        {accounts.length === 1 && account ? (
          <p id="clone-gist-account" className="mt-4 text-sm text-zinc-400">
            Signed in as <span id="clone-gist-account-name">{account}</span>
          </p>
        ) : null}
        {showPicker ? (
          <label
            id="clone-gist-filter-label"
            htmlFor="clone-gist-filter-input"
            className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
          >
            Gists
          </label>
        ) : null}
        {showPicker ? (
          <input
            id="clone-gist-filter-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={cloning || loadingGists}
            placeholder="Filter by description"
            className={`${fieldClass} w-full`}
          />
        ) : null}
        {showPicker ? (
          <label
            id="clone-gist-hide-existing-label"
            htmlFor="clone-gist-hide-existing"
            className="mt-2 flex items-center gap-2 text-sm text-zinc-300"
          >
            <input
              id="clone-gist-hide-existing"
              type="checkbox"
              checked={hideExisting}
              disabled={cloning || loadingGists}
              onChange={(event) => setHideExisting(event.target.checked)}
              className="size-3.5 accent-sky-500 disabled:opacity-50"
            />
            <span id="clone-gist-hide-existing-text">
              Hide gists already in the tree
              {hiddenCount > 0 ? ` (${hiddenCount})` : ""}
            </span>
          </label>
        ) : null}
        {showPicker ? (
          <div
            id="clone-gist-list"
            role="listbox"
            aria-labelledby="clone-gist-filter-label"
            aria-busy={loadingGists}
            className="mt-2 max-h-52 overflow-auto rounded-md border border-zinc-700 bg-zinc-950"
          >
            {loadingGists ? (
              <p id="clone-gist-list-loading" className="px-3 py-2 text-sm text-zinc-400">
                Loading gists…
              </p>
            ) : listError ? (
              <p id="clone-gist-list-error-inline" className="px-3 py-2 text-sm text-red-400">
                {listError}
              </p>
            ) : visible.length === 0 ? (
              <p id="clone-gist-empty" className="px-3 py-2 text-sm text-zinc-400">
                {gists.length === 0
                  ? "This account has no gists."
                  : available.length === 0
                    ? "Every listed gist is already in the tree."
                    : "No gists match that filter."}
              </p>
            ) : (
              visible.map((gist) => {
                const id = gistDomId(gist.id);
                const selected = url.trim() === gist.url;
                return (
                  <button
                    id={id}
                    key={gist.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={cloning}
                    onClick={() => applySelection(gist.url, gist.folder)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-zinc-800 disabled:opacity-50 ${
                      selected ? "bg-sky-950/70" : ""
                    }`}
                  >
                    <span id={`${id}-row`} className="flex w-full min-w-0 items-center gap-2">
                      <span id={`${id}-name`} className="min-w-0 truncate text-sm text-zinc-100">
                        {gist.name}
                      </span>
                      <span id={`${id}-visibility`} className="shrink-0 text-xs text-zinc-500">
                        {gist.public ? "Public" : "Secret"}
                      </span>
                    </span>
                    {gist.description ? (
                      <span id={`${id}-description`} className="w-full truncate text-xs text-zinc-500">
                        {gist.description}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
        {truncated ? (
          <p id="clone-gist-truncated" className="mt-1 text-xs text-zinc-500">
            Showing the 1000 most recent gists. Paste a URL for any other gist.
          </p>
        ) : null}
        {notice ? (
          <p id="clone-gist-notice" className="mt-4 text-sm text-zinc-400">
            {notice}
          </p>
        ) : null}
        <label
          id="clone-gist-url-label"
          htmlFor="clone-gist-url-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Gist URL
        </label>
        <input
          id="clone-gist-url-input"
          value={url}
          onChange={(event) => applySelection(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="https://gist.github.com/id.git"
          className={`${fieldClass} w-full`}
        />
        <label
          id="clone-gist-parent-label"
          htmlFor="clone-gist-parent-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Parent folder
        </label>
        <div id="clone-gist-parent-row" className="flex gap-2">
          <input
            id="clone-gist-parent-input"
            value={parent}
            onChange={(event) => {
              setParent(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={cloning}
            placeholder="Select a folder"
            className={fieldClass}
          />
          <Button id="clone-gist-browse" onClick={() => void browse()} disabled={cloning}>
            <span id="clone-gist-browse-label">Browse</span>
          </Button>
        </div>
        <label
          id="clone-gist-name-label"
          htmlFor="clone-gist-name-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folder name
        </label>
        <input
          id="clone-gist-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            nameEditedRef.current = true;
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="gist"
          className={`${fieldClass} w-full`}
        />
        <p id="clone-gist-hint" className="mt-1 text-xs text-zinc-500">
          The parent folder must already exist. The new folder must not.
        </p>
        {error ? (
          <p id="clone-gist-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div id="clone-gist-actions" className="mt-4 flex justify-end gap-2">
          <Button id="clone-gist-cancel" variant="ghost" onClick={requestClose} disabled={cloning}>
            <span id="clone-gist-cancel-label">Cancel</span>
          </Button>
          <Button id="clone-gist-submit" variant="primary" type="submit" disabled={cloning || !canSubmit}>
            <span id="clone-gist-submit-label">{cloning ? "Cloning…" : "Clone gist"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
