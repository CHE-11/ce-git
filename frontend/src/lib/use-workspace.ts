import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiCommitDraft, AiPrompts, AiSettings, AppSettings, BatchProgress, FileChange, RepoDiff, RepoStatus, TreeNode } from "../../../types/git";
import {
  aiSettings,
  appSettings,
  batchCommit,
  batchPull,
  batchPush,
  deleteFolder as deleteFolderOnDisk,
  discardChange as discardFile,
  discoverRepos,
  generateCommitMessage,
  gitAvailable,
  ignoreChange as ignoreFile,
  initRepo,
  openChange as openFile,
  openInEditor as openFolderInEditor,
  revealInExplorer as revealFolderInExplorer,
  patchAppSettings,
  revealChange as revealFile,
  themeCss,
  type ChangeOpenMode,
  type FolderEditor,
  type IgnoreKind,
  repoDiff,
  repoStatuses,
} from "./git-client";
import { withDefaultPrompts } from "./commit-prompts";
import { baseName, collectRepos, containingRoot, hideIgnoredFolders, hideRemovedRepos, messageOf, pathEquals, pathIsInside, pickedFolderPath } from "./tree";
import { applyUserThemeCss, publishAppearance } from "./appearance";
import { clampZoom, publishZoom, readZoom, ZOOM_EVENT } from "./zoom";

type SelectMode = "replace" | "toggle" | "range";

const VERBOSITY_KEY = "ce-git.commit-verbosity";
const PROMPT_KEY = "ce-git.commit-prompt";
const CHECK_INTERVAL_MS = 10_000;

function readPromptSlot(): number {
  try {
    const raw = localStorage.getItem(PROMPT_KEY);
    if (raw === "1" || raw === "2" || raw === "3") {
      return Number(raw);
    }
    if (localStorage.getItem(VERBOSITY_KEY) === "descriptive") {
      return 1;
    }
  } catch {
    return 2;
  }
  return 2;
}

function joinCommit(subject: string, description: string) {
  const summary = subject.trim();
  const detail = description.trim();
  if (!detail) {
    return summary;
  }
  return `${summary}\n\n${detail}`;
}

function samePaths(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((path, index) => pathEquals(path, right[index] ?? ""));
}

function treeKey(node: TreeNode): string {
  return `${node.kind}\u0000${node.path}\u0000${node.children.map(treeKey).join("\u0001")}`;
}

function sameTrees(left: readonly TreeNode[], right: readonly TreeNode[]) {
  return left.length === right.length && left.every((node, index) => treeKey(node) === treeKey(right[index]));
}

function statusKey(status: RepoStatus) {
  return [
    status.path,
    status.name,
    status.branch,
    status.detached,
    status.upstream ?? "",
    status.github,
    status.ahead,
    status.behind,
    status.dirty,
    status.staged,
    status.unstaged,
    status.untracked,
    status.defaultBranch ?? "",
    status.error ?? "",
  ].join("\u0000");
}

function sameStatuses(current: Record<string, RepoStatus>, rows: readonly RepoStatus[]) {
  const keys = Object.keys(current);
  return keys.length === rows.length && rows.every((row) => current[row.path] && statusKey(current[row.path]) === statusKey(row));
}

function diffKey(diff: RepoDiff | null) {
  if (!diff) {
    return "";
  }
  const files = diff.files
    .map((file) => `${file.path}\u0000${file.previousPath ?? ""}\u0000${file.status}\u0000${file.staged}`)
    .join("\u0001");
  return `${diff.truncated}\u0000${diff.patch}\u0000${files}`;
}

function rememberPrompt(value: number) {
  localStorage.setItem(PROMPT_KEY, String(value));
}

function promptSlot(value: number | null) {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function reduceLog(current: BatchProgress[], next: BatchProgress) {
  const reversedIndex = [...current]
    .reverse()
    .findIndex((entry) => entry.repo === next.repo && entry.action === next.action && entry.status === "running");
  if (reversedIndex >= 0 && next.status !== "running") {
    const index = current.length - 1 - reversedIndex;
    const copy = [...current];
    copy[index] = next;
    return copy;
  }
  return [...current, next].slice(-500);
}

export function useWorkspace() {
  const [rootPaths, setRootPaths] = useState<string[]>([]);
  const [trees, setTrees] = useState<TreeNode[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [diff, setDiff] = useState<RepoDiff | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [commitPrompts, setCommitPrompts] = useState<AiPrompts>(withDefaultPrompts(undefined));
  const [selectedPrompt, setSelectedPrompt] = useState(readPromptSlot);
  const [logs, setLogs] = useState<BatchProgress[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [detailToken, setDetailToken] = useState(0);
  const [gitReady, setGitReady] = useState(true);
  const [openaiReady, setOpenaiReady] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [drafts, setDrafts] = useState<AiCommitDraft[]>([]);
  const [pullPaths, setPullPaths] = useState<string[] | null>(null);
  const [pushPaths, setPushPaths] = useState<string[] | null>(null);
  const [removedRepos, setRemovedRepos] = useState<string[]>([]);

  const sharedRef = useRef(false);
  const zoomRef = useRef(readZoom());
  const rootPathsRef = useRef<string[]>([]);
  const removedRef = useRef<string[]>([]);
  const sourceTreesRef = useRef<TreeNode[]>([]);
  const folderIgnoreRef = useRef("");
  const anchorRef = useRef<string | null>(null);
  const repoPathsRef = useRef<string[]>([]);
  const logGeneration = useRef(0);
  const seenGeneration = useRef(0);
  const busyRef = useRef(false);
  const discoveringRef = useRef(false);
  const gitReadyRef = useRef(true);
  const scanRef = useRef<Promise<string[]> | null>(null);
  const statusPollRef = useRef<Promise<void> | null>(null);
  const statusesRef = useRef<Record<string, RepoStatus>>({});
  const activePathRef = useRef<string | null>(null);
  const scanErrorRef = useRef<string | null>(null);
  const interactionEpoch = useRef(0);
  const pointerDownRef = useRef(0);

  const repos = useMemo(() => trees.flatMap((node) => collectRepos(node)), [trees]);
  const repoPaths = useMemo(() => repos.map((repo) => repo.path), [repos]);

  useEffect(() => {
    repoPathsRef.current = repoPaths;
  }, [repoPaths]);

  const beginWork = (action: string) => {
    interactionEpoch.current += 1;
    busyRef.current = true;
    setBusyAction(action);
  };

  const endWork = () => {
    busyRef.current = false;
    setBusyAction(null);
  };

  useEffect(() => {
    gitReadyRef.current = gitReady;
  }, [gitReady]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);

  const loadStatuses = useCallback(async (paths: string[], quiet = false) => {
    if (paths.length === 0) {
      setStatuses((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }
    if (!quiet) {
      setStatusLoading(true);
    }
    try {
      const rows = await repoStatuses(paths);
      setStatuses((current) => (sameStatuses(current, rows) ? current : Object.fromEntries(rows.map((row) => [row.path, row]))));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      if (!quiet) {
        setStatusLoading(false);
      }
    }
  }, []);

  const applyVisibleTrees = useCallback((source: TreeNode[]) => {
    sourceTreesRef.current = source;
    const visible = source.flatMap((node) => {
      const next = hideIgnoredFolders(node, folderIgnoreRef.current);
      return next ? [next] : [];
    });
    const found = visible.flatMap((node) => collectRepos(node));
    setTrees((current) => (sameTrees(current, visible) ? current : visible));
    setSelectedPaths((current) => {
      const next = current.filter((path) => found.some((repo) => pathEquals(repo.path, path)));
      return next.length === current.length ? current : next;
    });
    const currentActive = activePathRef.current;
    const nextActive =
      currentActive && found.some((repo) => pathEquals(repo.path, currentActive)) ? currentActive : (found[0]?.path ?? null);
    activePathRef.current = nextActive;
    setActivePath(nextActive);
    return found.map((repo) => repo.path);
  }, []);

  const reloadTrees = useCallback(
    async (roots: string[], quiet = false) => {
      if (scanRef.current) {
        if (quiet) {
          return repoPathsRef.current;
        }
        await scanRef.current.catch(() => []);
      }

      const run = (async () => {
        interactionEpoch.current += 1;
        if (roots.length === 0) {
          sourceTreesRef.current = [];
          setTrees([]);
          setStatuses({});
          setSelectedPaths([]);
          activePathRef.current = null;
          setActivePath(null);
          return [];
        }
        if (!quiet) {
          discoveringRef.current = true;
          setDiscovering(true);
          scanErrorRef.current = null;
          setError(null);
        }
        try {
          const results = await Promise.all(
            roots.map(async (root) => {
              try {
                const discovered = await discoverRepos(root);
                return { tree: hideRemovedRepos(discovered, removedRef.current), error: null as string | null };
              } catch (caught) {
                return { tree: null, error: messageOf(caught) };
              }
            }),
          );
          const failures = results.flatMap((result) => (result.error ? [result.error] : []));
          if (failures.length > 0) {
            const message = failures.join(" ");
            scanErrorRef.current = message;
            setError(message);
          } else if (scanErrorRef.current) {
            const previous = scanErrorRef.current;
            scanErrorRef.current = null;
            setError((current) => (current === previous ? null : current));
          }
          const nextTrees = results.flatMap((result) => (result.tree ? [result.tree] : []));
          const foundPaths = quiet && sameTrees(sourceTreesRef.current, nextTrees) ? repoPathsRef.current : applyVisibleTrees(nextTrees);
          await loadStatuses(foundPaths, quiet);
          return foundPaths;
        } catch (caught) {
          const message = messageOf(caught);
          scanErrorRef.current = message;
          setError(message);
          return [];
        } finally {
          if (!quiet) {
            discoveringRef.current = false;
            setDiscovering(false);
          }
        }
      })();

      scanRef.current = run;
      try {
        return await run;
      } finally {
        if (scanRef.current === run) {
          scanRef.current = null;
        }
      }
    },
    [applyVisibleTrees, loadStatuses],
  );

  const applyAiSettings = (settings: AiSettings) => {
    const next = withDefaultPrompts(settings.prompts);
    setOpenaiReady(settings.configured);
    setCommitPrompts(next);
    setSelectedPrompt((current) => {
      const slot = promptSlot(current);
      rememberPrompt(slot);
      return slot;
    });
  };

  const themeCssError = useRef<string | null>(null);

  const refreshThemeCss = useCallback(async () => {
    try {
      applyUserThemeCss(await themeCss());
      if (themeCssError.current) {
        const previous = themeCssError.current;
        themeCssError.current = null;
        setError((current) => (current === previous ? null : current));
      }
    } catch (caught) {
      const message = messageOf(caught);
      themeCssError.current = message;
      applyUserThemeCss("");
      setError(message);
    }
  }, []);

  const applyAppSettings = useCallback(
    async (settings: AppSettings, source: "startup" | "save" = "save") => {
      void refreshThemeCss();
      sharedRef.current = settings.shared;
      const nextIgnore = settings.folderIgnore ?? "";
      const ignoreChanged = nextIgnore !== folderIgnoreRef.current;
      folderIgnoreRef.current = nextIgnore;
      const useFilePreferences = settings.shared || source === "save";
      if (useFilePreferences) {
        const prompts = withDefaultPrompts(settings.prompts);
        const prompt = promptSlot(settings.selectedPrompt);
        zoomRef.current = clampZoom(settings.fontZoom);
        publishZoom(settings.fontZoom);
        publishAppearance(settings.theme, settings.colorMode);
        setSelectedPrompt(prompt);
        rememberPrompt(prompt);
        setCommitPrompts(prompts);
      }

      const roots = settings.rootPaths.filter((path) => path.trim().length > 0);
      const removed = settings.removedRepos.filter((path) => path.trim().length > 0);
      const changed = source === "startup" || !samePaths(rootPathsRef.current, roots) || !samePaths(removedRef.current, removed);
      rootPathsRef.current = roots;
      removedRef.current = removed;
      setRootPaths(roots);
      setRemovedRepos(removed);
      if (!changed) {
        if (ignoreChanged) {
          const paths = applyVisibleTrees(sourceTreesRef.current);
          await loadStatuses(paths);
        }
        return;
      }
      await reloadTrees(roots);
    },
    [applyVisibleTrees, loadStatuses, refreshThemeCss, reloadTrees],
  );

  useEffect(() => {
    const onFocus = () => {
      void refreshThemeCss();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshThemeCss]);

  useEffect(() => {
    function onZoom(event: Event) {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail !== "number" || !sharedRef.current) {
        return;
      }
      const next = clampZoom(detail);
      if (next === zoomRef.current) {
        return;
      }
      zoomRef.current = next;
      void patchAppSettings({ fontZoom: next }).catch((caught) => setError(messageOf(caught)));
    }

    window.addEventListener(ZOOM_EVENT, onZoom);
    return () => window.removeEventListener(ZOOM_EVENT, onZoom);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [available, settings] = await Promise.all([gitAvailable(), appSettings()]);
        if (cancelled) {
          return;
        }
        setGitReady(available);
        if (!available) {
          setError("git was not found on PATH.");
        }
        await applyAppSettings(settings, "startup");
        if (cancelled) {
          return;
        }
        applyAiSettings(await aiSettings());
        if (!cancelled && settings.warning) {
          setError((current) => current ?? settings.warning);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(messageOf(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAppSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void listen<BatchProgress>("batch-progress", (event) => {
      setLogs((current) => {
        const base = seenGeneration.current === logGeneration.current ? current : [];
        seenGeneration.current = logGeneration.current;
        return reduceLog(base, event.payload);
      });
    }).then((stop) => {
      if (active) {
        unlisten = stop;
      } else {
        stop();
      }
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setCommitMessage("");
    setCommitDescription("");
  }, [activePath]);

  useEffect(() => {
    if (!activePath) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void repoDiff(activePath)
      .then((next) => {
        if (!cancelled) {
          setDiff(next);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setDiff(null);
          setError(messageOf(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDiffLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, detailToken]);

  const pickFolder = async (title: string) => {
    const picked = await open({
      directory: true,
      multiple: false,
      title,
    });
    return pickedFolderPath(picked);
  };

  const persistRoots = async (paths: string[]) => {
    await patchAppSettings({ rootPaths: paths });
    rootPathsRef.current = paths;
    setRootPaths(paths);
  };

  const chooseFolder = async () => {
    const picked = await pickFolder("Choose a folder of repositories");
    if (!picked) {
      return;
    }
    setError(null);
    try {
      await persistRoots([picked]);
      await reloadTrees([picked]);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const createNewRepo = async (picked: string) => {
    const path = picked.trim();
    if (!path) {
      throw new Error("Choose a folder on disk.");
    }
    await initRepo(path);
    const current = rootPathsRef.current;
    const roots = containingRoot(current, path)
      ? current
      : [...current.filter((root) => !pathIsInside(path, root)), path];
    if (roots !== current) {
      await persistRoots(roots);
    }
    const found = await reloadTrees(roots);
    const created = found.find((repo) => pathEquals(repo, path)) ?? path;
    anchorRef.current = created;
    interactionEpoch.current += 1;
    activePathRef.current = created;
    setActivePath(created);
    setSelectedPaths([created]);
  };

  const addRootFolder = async () => {
    const picked = await pickFolder("Add a folder of repositories");
    if (!picked) {
      return;
    }
    const current = rootPathsRef.current;
    const owner = containingRoot(current, picked);
    if (owner && pathEquals(owner, picked)) {
      setError("That folder is already open.");
      return;
    }
    if (owner) {
      setError(`That folder is already inside ${baseName(owner)}.`);
      return;
    }
    const next = [...current.filter((root) => !pathIsInside(picked, root)), picked];
    setError(null);
    try {
      await persistRoots(next);
      await reloadTrees(next);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const refresh = async () => {
    if (rootPathsRef.current.length > 0) {
      await reloadTrees(rootPathsRef.current);
      setDetailToken((token) => token + 1);
    }
  };

  const checkForChanges = useCallback(async () => {
    if (
      document.hidden ||
      pointerDownRef.current > 0 ||
      !gitReadyRef.current ||
      busyRef.current ||
      discoveringRef.current ||
      scanRef.current ||
      statusPollRef.current
    ) {
      return;
    }
    const paths = repoPathsRef.current;
    if (paths.length === 0) {
      return;
    }
    const epoch = interactionEpoch.current;
    const activeAtStart = activePathRef.current;

    const run = (async () => {
      let rows: RepoStatus[];
      try {
        rows = await repoStatuses(paths);
      } catch {
        return;
      }
      if (!pollStillCurrent(epoch, paths)) {
        return;
      }
      setStatuses((current) => (sameStatuses(current, rows) ? current : Object.fromEntries(rows.map((row) => [row.path, row]))));

      const active = activePathRef.current;
      if (!active || !activeAtStart || !pathEquals(active, activeAtStart) || !paths.some((path) => pathEquals(path, active))) {
        return;
      }
      try {
        const next = await repoDiff(active);
        if (!pollStillCurrent(epoch, paths) || !activePathRef.current || !pathEquals(activePathRef.current, active)) {
          return;
        }
        setDiff((current) => (diffKey(current) === diffKey(next) ? current : next));
      } catch {
        // A background check leaves the open diff in place.
      }
    })();

    statusPollRef.current = run;
    try {
      await run;
    } finally {
      if (statusPollRef.current === run) {
        statusPollRef.current = null;
      }
    }

    function pollStillCurrent(startedAt: number, startedPaths: readonly string[]) {
      return (
        interactionEpoch.current === startedAt &&
        pointerDownRef.current === 0 &&
        !busyRef.current &&
        !discoveringRef.current &&
        !scanRef.current &&
        samePaths(startedPaths, repoPathsRef.current)
      );
    }
  }, []);

  const checkRef = useRef(checkForChanges);
  checkRef.current = checkForChanges;

  useEffect(() => {
    const down = () => {
      pointerDownRef.current += 1;
    };
    const up = () => {
      pointerDownRef.current = Math.max(0, pointerDownRef.current - 1);
    };
    const tick = () => {
      if (!document.hidden && pointerDownRef.current === 0) {
        void checkRef.current();
      }
    };
    const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const selectRepo = (path: string, mode: SelectMode) => {
    interactionEpoch.current += 1;
    activePathRef.current = path;
    setActivePath(path);
    setSelectedPaths((current) => {
      if (mode === "toggle") {
        anchorRef.current = path;
        return current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
      }
      if (mode === "range" && anchorRef.current) {
        const order = repoPathsRef.current;
        const start = order.indexOf(anchorRef.current);
        const end = order.indexOf(path);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          return order.slice(from, to + 1);
        }
      }
      anchorRef.current = path;
      return [path];
    });
  };

  const clearSelection = () => {
    setSelectedPaths([]);
  };

  const persistRemoved = async (paths: string[]) => {
    await patchAppSettings({ removedRepos: paths });
    removedRef.current = paths;
    setRemovedRepos(paths);
  };

  const openInEditor = async (path: string, editor: FolderEditor = "default") => {
    setError(null);
    try {
      await openFolderInEditor(path, editor);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const revealInExplorer = async (path: string) => {
    setError(null);
    try {
      await revealFolderInExplorer(path);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const removeRepo = async (path: string) => {
    if (trees.length === 0 || removedRef.current.some((item) => pathEquals(item, path))) {
      return;
    }
    setError(null);
    try {
      const nextRemoved = [...removedRef.current, path];
      await persistRemoved(nextRemoved);
      const nextSource = sourceTreesRef.current.map((node) => hideRemovedRepos(node, nextRemoved));
      applyVisibleTrees(nextSource);
      setStatuses((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (pathEquals(key, path)) {
            delete next[key];
          }
        }
        return next;
      });
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const restoreRemoved = async () => {
    const roots = rootPathsRef.current;
    if (roots.length === 0) {
      return;
    }
    setError(null);
    try {
      const next = removedRef.current.filter((path) => !containingRoot(roots, path));
      await persistRemoved(next);
      await reloadTrees(roots);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const deleteFolder = async (path: string) => {
    const roots = rootPathsRef.current;
    const owner = containingRoot(roots, path);
    if (!owner) {
      setError("That folder is outside the open folders.");
      return;
    }
    if (pathEquals(path, owner)) {
      setError("An open folder cannot be deleted.");
      return;
    }
    beginWork("delete");
    setError(null);
    try {
      await deleteFolderOnDisk(owner, path);
      const next = removedRef.current.filter((item) => !pathEquals(item, path) && !pathIsInside(path, item));
      if (next.length !== removedRef.current.length) {
        await persistRemoved(next);
      }
      await reloadTrees(roots);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const refreshRepo = async (repo: string) => {
    interactionEpoch.current += 1;
    const rows = await repoStatuses([repo]);
    setStatuses((current) => {
      const next = { ...current };
      for (const row of rows) {
        next[row.path] = row;
      }
      return next;
    });
    setDetailToken((token) => token + 1);
  };

  const discardChange = async (repo: string, file: FileChange) => {
    if (!repo) {
      return;
    }
    beginWork("discard");
    setError(null);
    try {
      await discardFile(repo, file.path);
      await refreshRepo(repo);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const ignoreChange = async (repo: string, kind: IgnoreKind, target: string) => {
    if (!repo) {
      return;
    }
    beginWork("ignore");
    setError(null);
    try {
      await ignoreFile(repo, kind, target);
      await refreshRepo(repo);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const revealChange = async (repo: string, relativePath: string) => {
    setError(null);
    try {
      await revealFile(repo, relativePath);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const openChange = async (repo: string, relativePath: string, mode: ChangeOpenMode) => {
    setError(null);
    try {
      await openFile(repo, relativePath, mode);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const reportError = (message: string) => {
    setError(message);
  };

  const finishBatch = async () => {
    interactionEpoch.current += 1;
    await loadStatuses(repoPathsRef.current);
    setDetailToken((token) => token + 1);
  };

  const runBatch = async (action: "pull" | "push", paths: string[]) => {
    if (paths.length === 0) {
      setError(action === "pull" ? "No repositories to pull." : "No repositories to push.");
      return;
    }
    logGeneration.current += 1;
    seenGeneration.current = logGeneration.current;
    setLogs([]);
    beginWork(action);
    setError(null);
    try {
      if (action === "pull") {
        await batchPull(paths);
      } else {
        await batchPush(paths);
      }
      await finishBatch();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const requestPull = (paths: string[]) => {
    if (paths.length === 0) {
      setError("No repositories to pull.");
      return;
    }
    setPullPaths(paths);
  };

  const confirmPull = async () => {
    await runBatch("pull", pullPaths ?? []);
  };

  const requestPush = (paths: string[]) => {
    if (paths.length === 0) {
      setError("No repositories to push.");
      return;
    }
    setPushPaths(paths);
  };

  const confirmPush = async () => {
    await runBatch("push", pushPaths ?? []);
  };

  const commitActive = async () => {
    if (!activePath) {
      return;
    }
    const message = joinCommit(commitMessage, commitDescription);
    if (!message) {
      setError("Enter a commit message.");
      return;
    }
    logGeneration.current += 1;
    beginWork("commit");
    setError(null);
    try {
      await batchCommit([{ path: activePath, message }]);
      setCommitMessage("");
      setCommitDescription("");
      await finishBatch();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const activePrompt = () => {
    const prompts = withDefaultPrompts(commitPrompts);
    return prompts[promptSlot(selectedPrompt) - 1]?.trim() ?? "";
  };

  const generateIntoBox = async (path: string, prompt = activePrompt()) => {
    interactionEpoch.current += 1;
    activePathRef.current = path;
    setActivePath(path);
    setGenerating(true);
    setError(null);
    try {
      const generated = await generateCommitMessage(path, prompt);
      setCommitMessage(generated.subject);
      setCommitDescription(generated.description);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setGenerating(false);
    }
  };

  const startAiCommit = async (paths: string[], prompt = activePrompt()) => {
    if (paths.length === 0) {
      setError("No repositories with changes.");
      return;
    }
    if (paths.length === 1) {
      await generateIntoBox(paths[0], prompt);
      return;
    }

    setDrafts(
      paths.map((path) => ({
        path,
        name: baseName(path),
        message: "",
        description: "",
        error: null,
        include: true,
      })),
    );
    setAiOpen(true);
    setGenerating(true);
    setError(null);
    const queue = [...paths];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const path = queue.shift();
        if (!path) {
          return;
        }
        try {
          const generated = await generateCommitMessage(path, prompt);
          setDrafts((current) =>
            current.map((draft) =>
              draft.path === path
                ? { ...draft, message: generated.subject, description: generated.description, error: null, include: true }
                : draft,
            ),
          );
        } catch (caught) {
          setDrafts((current) =>
            current.map((draft) =>
              draft.path === path ? { ...draft, error: messageOf(caught), include: false } : draft,
            ),
          );
        }
      }
    });
    await Promise.all(workers);
    setGenerating(false);
  };

  const commitDrafts = async () => {
    const items = drafts
      .filter((draft) => draft.include && draft.message.trim().length > 0)
      .map((draft) => ({ path: draft.path, message: joinCommit(draft.message, draft.description) }));
    if (items.length === 0) {
      setError("No commit messages to apply.");
      return;
    }
    logGeneration.current += 1;
    beginWork("commit");
    setError(null);
    try {
      await batchCommit(items);
      setAiOpen(false);
      setDrafts([]);
      if (activePath && items.some((item) => item.path === activePath)) {
        setCommitMessage("");
        setCommitDescription("");
      }
      await finishBatch();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      endWork();
    }
  };

  const clearCommitDrafts = () => {
    setCommitMessage("");
    setCommitDescription("");
    setDrafts([]);
    setAiOpen(false);
  };

  const activeStatus = activePath ? (statuses[activePath] ?? null) : null;

  return {
    rootPaths,
    trees,
    repos,
    statuses,
    selectedPaths,
    activePath,
    activeStatus,
    diff,
    commitMessage,
    setCommitMessage,
    commitDescription,
    setCommitDescription,
    commitPrompts,
    selectedPrompt,
    setSelectedPrompt: (value: number) => {
      const slot = promptSlot(value);
      setSelectedPrompt(slot);
      rememberPrompt(slot);
      if (!sharedRef.current) {
        return;
      }
      void patchAppSettings({ selectedPrompt: slot }).catch((caught) => setError(messageOf(caught)));
    },
    applyAppSettings,
    logs,
    clearLogs: () => setLogs([]),
    busyAction,
    error,
    discovering,
    statusLoading,
    diffLoading,
    gitReady,
    openaiReady,
    refreshAi: async () => {
      applyAiSettings(await aiSettings());
    },
    generating,
    aiOpen,
    setAiOpen,
    drafts,
    setDrafts,
    pullPaths,
    setPullPaths,
    pushPaths,
    setPushPaths,
    chooseFolder,
    addRootFolder,
    createNewRepo,
    refresh,
    selectRepo,
    clearSelection,
    removedRepos,
    openInEditor,
    revealInExplorer,
    removeRepo,
    restoreRemoved,
    deleteFolder,
    discardChange,
    ignoreChange,
    revealChange,
    openChange,
    reportError,
    pullAll: () => runBatch("pull", repoPaths),
    pullSelected: () => runBatch("pull", selectedPaths),
    requestPullAll: () => requestPull(repoPaths),
    confirmPull,
    requestPushAll: () => requestPush(repoPaths),
    requestPushSelected: () => requestPush(selectedPaths),
    confirmPush,
    commitActive,
    generateForActive: () => {
      if (activePath) {
        void generateIntoBox(activePath);
      }
    },
    startAiForSelection: () => {
      const paths = selectedPaths.length > 0 ? selectedPaths : activePath ? [activePath] : [];
      void startAiCommit(paths);
    },
    startAiForDirty: (slot: number) => {
      const promptSlot = slot === 1 || slot === 2 || slot === 3 ? slot : 1;
      const prompts = withDefaultPrompts(commitPrompts);
      const prompt = prompts[promptSlot - 1]?.trim() ?? "";
      setSelectedPrompt(promptSlot);
      rememberPrompt(promptSlot);
      if (sharedRef.current) {
        void patchAppSettings({ selectedPrompt: promptSlot }).catch((caught) => setError(messageOf(caught)));
      }
      const paths = repoPaths.filter((path) => statuses[path]?.dirty);
      void startAiCommit(paths, prompt);
    },
    commitDrafts,
    clearCommitDrafts,
    updateDraft: (path: string, patch: Partial<Pick<AiCommitDraft, "message" | "description">>) => {
      setDrafts((current) => current.map((draft) => (draft.path === path ? { ...draft, ...patch } : draft)));
    },
    toggleDraft: (path: string) => {
      setDrafts((current) =>
        current.map((draft) => (draft.path === path ? { ...draft, include: !draft.include } : draft)),
      );
    },
  };
}
