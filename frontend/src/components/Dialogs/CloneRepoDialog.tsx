import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubGist, GithubRepo, TreeNode } from "../../../../types/git";
import { listGithubGists, listGithubRepos } from "../../lib/git-client";
import { collectRepos, messageOf, pickedFolderPath } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type CloneRepoDialogProps = {
  trees?: TreeNode[];
  defaultParent?: string;
  onClose: () => void;
  onClone: (url: string, destination: string) => Promise<void>;
};

function repoNameFromUrl(url: string) {
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

function githubShortName(name: string) {
  return name.split("/").pop()?.trim().toLowerCase() ?? "";
}

function repoDomId(name: string) {
  const slug = name.replaceAll("/", "--").replace(/[^A-Za-z0-9._-]/g, "");
  return `clone-repo-${slug || "repo"}`;
}

function accountDomId(account: string) {
  const slug = account.replace(/[^A-Za-z0-9._-]/g, "");
  return `clone-repo-account-${slug || "account"}`;
}

function gistDomId(id: string) {
  const slug = id.replace(/[^A-Za-z0-9._-]/g, "");
  return `clone-gist-${slug || "gist"}`;
}

type CloneSource = "repos" | "gists";

export function CloneRepoDialog({ trees = [], defaultParent = "", onClose, onClone }: CloneRepoDialogProps) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(defaultParent);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [filter, setFilter] = useState("");
  const [hideExisting, setHideExisting] = useState(true);
  const requestRef = useRef(0);
  const nameEditedRef = useRef(false);

  const [source, setSource] = useState<CloneSource>("repos");
  const [gists, setGists] = useState<GithubGist[]>([]);

  const applySelection = (next: string, folder?: string) => {
    setUrl(next);
    setError(null);
    if (!nameEditedRef.current) {
      setName(folder ?? repoNameFromUrl(next));
    }
  };

  const loadList = (requested: string, nextSource: CloneSource) => {
    const id = ++requestRef.current;
    setLoadingRepos(true);
    setListError(null);
    setNotice(null);
    setTruncated(false);
    if (nextSource === "repos") {
      setRepos([]);
    } else {
      setGists([]);
    }
    const request =
      nextSource === "repos" ? listGithubRepos(requested) : listGithubGists(requested);
    request.then(
      (page) => {
        if (requestRef.current !== id) {
          return;
        }
        setAccounts(page.accounts);
        setTruncated(page.truncated);
        setNotice(page.notice);
        if (requested === "" && page.account) {
          setAccount(page.account);
        }
        if (nextSource === "repos" && "repos" in page) {
          setRepos(page.repos);
        }
        if (nextSource === "gists" && "gists" in page) {
          setGists(page.gists);
        }
        setLoadingRepos(false);
      },
      (caught) => {
        if (requestRef.current !== id) {
          return;
        }
        if (nextSource === "repos") {
          setRepos([]);
        } else {
          setGists([]);
        }
        setTruncated(false);
        setNotice(null);
        setListError(messageOf(caught));
        setLoadingRepos(false);
      },
    );
  };

  useEffect(() => {
    loadList("", "repos");
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
      setError(source === "gists" ? "Choose a gist or enter a URL." : "Choose a repository or enter a URL.");
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
  const inTree = (repo: GithubRepo) => existingNames.has(githubShortName(repo.name));
  const inTreeGist = (gist: GithubGist) =>
    existingNames.has(gist.folder.toLowerCase()) || existingNames.has(gist.id.toLowerCase());
  const hiddenCount = source === "gists" ? gists.filter(inTreeGist).length : repos.filter(inTree).length;
  const available = hideExisting ? repos.filter((repo) => !inTree(repo)) : repos;
  const visible = query
    ? available.filter(
        (repo) =>
          repo.name.toLowerCase().includes(query) || repo.description.toLowerCase().includes(query),
      )
    : available;
  const availableGists = hideExisting ? gists.filter((gist) => !inTreeGist(gist)) : gists;
  const visibleGists = query
    ? availableGists.filter(
        (gist) =>
          gist.name.toLowerCase().includes(query) ||
          gist.description.toLowerCase().includes(query) ||
          gist.id.toLowerCase().includes(query),
      )
    : availableGists;
  const canSubmit = url.trim().length > 0 && parent.trim().length > 0 && name.trim().length > 0;
  const showPicker = accounts.length > 0;
  const tabClass = (selected: boolean) =>
    selected
      ? "rounded-md border border-sky-500 bg-sky-950/40 px-3 py-1.5 text-sm text-zinc-100"
      : "rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500";

  return (
    <Dialog id="clone-repo-dialog" title="Clone repository" open onClose={requestClose}>
      <form
        id="clone-repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void clone();
        }}
      >
        <p id="clone-repo-copy" className="text-sm text-zinc-300">
          Choose a repository or gist from a signed-in GitHub account, or paste any Git URL. If the new folder is not
          already under an open workspace folder, it is added to the tree.
        </p>
        {loadingRepos && !showPicker && !listError ? (
          <p id="clone-repo-loading" className="mt-4 text-sm text-zinc-400">
            {source === "gists" ? "Loading gists…" : "Loading repositories…"}
          </p>
        ) : null}
        {listError && !showPicker ? (
          <p id="clone-repo-list-error" className="mt-4 text-sm text-red-400">
            {listError}
          </p>
        ) : null}
        {accounts.length > 1 ? (
          <label
            id="clone-repo-account-label"
            htmlFor="clone-repo-account-select"
            className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
          >
            GitHub account
          </label>
        ) : null}
        {accounts.length > 1 ? (
          <select
            id="clone-repo-account-select"
            value={account}
            disabled={cloning || loadingRepos}
            onChange={(event) => {
              const next = event.target.value;
              setAccount(next);
              setFilter("");
              loadList(next, source);
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
          <p id="clone-repo-account" className="mt-4 text-sm text-zinc-400">
            Signed in as <span id="clone-repo-account-name">{account}</span>
          </p>
        ) : null}
        {showPicker ? (
          <div id="clone-source-tabs" role="tablist" aria-label="Clone source" className="mt-4 flex gap-2">
            <button
              id="clone-source-repos"
              type="button"
              role="tab"
              aria-selected={source === "repos"}
              aria-controls="clone-repo-list"
              disabled={cloning || loadingRepos}
              onClick={() => {
                if (source === "repos") {
                  return;
                }
                setSource("repos");
                setFilter("");
                loadList(account, "repos");
              }}
              className={tabClass(source === "repos")}
            >
              <span id="clone-source-repos-label">Repositories</span>
            </button>
            <button
              id="clone-source-gists"
              type="button"
              role="tab"
              aria-selected={source === "gists"}
              aria-controls="clone-gist-list"
              disabled={cloning || loadingRepos}
              onClick={() => {
                if (source === "gists") {
                  return;
                }
                setSource("gists");
                setFilter("");
                loadList(account, "gists");
              }}
              className={tabClass(source === "gists")}
            >
              <span id="clone-source-gists-label">Gists</span>
            </button>
          </div>
        ) : null}
        {showPicker ? (
          <label
            id="clone-repo-filter-label"
            htmlFor="clone-repo-filter-input"
            className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
          >
            {source === "gists" ? "Gists" : "Repositories"}
          </label>
        ) : null}
        {showPicker ? (
          <input
            id="clone-repo-filter-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={cloning || loadingRepos}
            placeholder={source === "gists" ? "Filter by description" : "Filter by name"}
            className={`${fieldClass} w-full`}
          />
        ) : null}
        {showPicker ? (
          <label
            id="clone-repo-hide-existing-label"
            htmlFor="clone-repo-hide-existing"
            className="mt-2 flex items-center gap-2 text-sm text-zinc-300"
          >
            <input
              id="clone-repo-hide-existing"
              type="checkbox"
              checked={hideExisting}
              disabled={cloning || loadingRepos}
              onChange={(event) => setHideExisting(event.target.checked)}
              className="size-3.5 accent-sky-500 disabled:opacity-50"
            />
            <span id="clone-repo-hide-existing-text">
              {source === "gists" ? "Hide gists already in the tree" : "Hide repositories already in the tree"}
              {hiddenCount > 0 ? ` (${hiddenCount})` : ""}
            </span>
          </label>
        ) : null}
        {showPicker && source === "repos" ? (
          <div
            id="clone-repo-list"
            role="listbox"
            aria-labelledby="clone-repo-filter-label"
            aria-busy={loadingRepos}
            className="mt-2 max-h-52 overflow-auto rounded-md border border-zinc-700 bg-zinc-950"
          >
            {loadingRepos ? (
              <p id="clone-repo-loading" className="px-3 py-2 text-sm text-zinc-400">
                Loading repositories and gists…
              </p>
            ) : listError ? (
              <p id="clone-repo-list-error" className="px-3 py-2 text-sm text-red-400">
                {listError}
              </p>
            ) : visible.length === 0 ? (
              <p id="clone-repo-empty" className="px-3 py-2 text-sm text-zinc-400">
                {repos.length === 0
                  ? "This account has no repositories."
                  : available.length === 0
                    ? "Every listed repository is already in the tree."
                    : "No repositories match that filter."}
              </p>
            ) : (
              visible.map((repo) => {
                const id = repoDomId(repo.name);
                const selected = url.trim() === repo.url;
                return (
                  <button
                    id={id}
                    key={repo.name}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={cloning}
                    onClick={() => applySelection(repo.url)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-zinc-800 disabled:opacity-50 ${
                      selected ? "bg-sky-950/70" : ""
                    }`}
                  >
                    <span id={`${id}-row`} className="flex w-full min-w-0 items-center gap-2">
                      <span id={`${id}-name`} className="min-w-0 truncate text-sm text-zinc-100">
                        {repo.name}
                      </span>
                      {repo.private ? (
                        <span id={`${id}-private`} className="shrink-0 text-xs text-zinc-500">
                          Private
                        </span>
                      ) : null}
                    </span>
                    {repo.description ? (
                      <span id={`${id}-description`} className="w-full truncate text-xs text-zinc-500">
                        {repo.description}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
        {showPicker && source === "gists" ? (
          <div
            id="clone-gist-list"
            role="listbox"
            aria-labelledby="clone-repo-filter-label"
            aria-busy={loadingRepos}
            className="mt-2 max-h-52 overflow-auto rounded-md border border-zinc-700 bg-zinc-950"
          >
            {loadingRepos ? (
              <p id="clone-gist-loading" className="px-3 py-2 text-sm text-zinc-400">
                Loading gists…
              </p>
            ) : listError ? (
              <p id="clone-gist-list-error" className="px-3 py-2 text-sm text-red-400">
                {listError}
              </p>
            ) : visibleGists.length === 0 ? (
              <p id="clone-gist-empty" className="px-3 py-2 text-sm text-zinc-400">
                {gists.length === 0
                  ? "This account has no gists."
                  : availableGists.length === 0
                    ? "Every listed gist is already in the tree."
                    : "No gists match that filter."}
              </p>
            ) : (
              visibleGists.map((gist) => {
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
                  </button>
                );
              })
            )}
          </div>
        ) : null}
        {truncated ? (
          <p id="clone-repo-truncated" className="mt-1 text-xs text-zinc-500">
            {source === "gists"
              ? "Showing the 1000 most recent gists. Paste a URL for any other gist."
              : "Showing the 1000 most recently pushed repositories. Paste a URL for any other remote."}
          </p>
        ) : null}
        {notice ? (
          <p id="clone-repo-notice" className="mt-4 text-sm text-zinc-400">
            {notice}
          </p>
        ) : null}
        <label
          id="clone-repo-url-label"
          htmlFor="clone-repo-url-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Repository URL
        </label>
        <input
          id="clone-repo-url-input"
          value={url}
          onChange={(event) => applySelection(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="https://github.com/owner/repo.git or https://gist.github.com/id.git"
          className={`${fieldClass} w-full`}
        />
        <label
          id="clone-repo-parent-label"
          htmlFor="clone-repo-parent-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Parent folder
        </label>
        <div id="clone-repo-parent-row" className="flex gap-2">
          <input
            id="clone-repo-parent-input"
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
          <Button id="clone-repo-browse" onClick={() => void browse()} disabled={cloning}>
            <span id="clone-repo-browse-label">Browse</span>
          </Button>
        </div>
        <label
          id="clone-repo-name-label"
          htmlFor="clone-repo-name-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folder name
        </label>
        <input
          id="clone-repo-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            nameEditedRef.current = true;
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={cloning}
          placeholder="repo"
          className={`${fieldClass} w-full`}
        />
        <p id="clone-repo-hint" className="mt-1 text-xs text-zinc-500">
          The parent folder must already exist. The new folder must not.
        </p>
        {error ? (
          <p id="clone-repo-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div id="clone-repo-actions" className="mt-4 flex justify-end gap-2">
          <Button id="clone-repo-cancel" variant="ghost" onClick={requestClose} disabled={cloning}>
            <span id="clone-repo-cancel-label">Cancel</span>
          </Button>
          <Button id="clone-repo-submit" variant="primary" type="submit" disabled={cloning || !canSubmit}>
            <span id="clone-repo-submit-label">{cloning ? "Cloning…" : source === "gists" ? "Clone gist" : "Clone repository"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
