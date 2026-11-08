import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { BatchProgress, FileChange, RepoStatus } from "../../../types/git";

const PUSH_DELAY_MS = 300;
const UI_LIMIT = 400;
const TEXT_LIMIT = 120;
const LOG_LIMIT = 30;
const DIFF_FILE_LIMIT = 200;
const CONSOLE_LIMIT = 80;
const MESSAGE_LIMIT = 2000;

export type DevDialogs = {
  settings: string | null;
  createRepo: boolean;
  cloneRepo: boolean;
  advancedSearch: boolean;
  commands: boolean;
  restore: boolean;
  graph: boolean;
  explorer: string | null;
  branch: string | null;
  aiReview: boolean;
  pullConfirm: boolean;
  pushConfirm: boolean;
  clearCommits: boolean;
  update: boolean;
};

export type DevWorkspaceInput = {
  rootPaths: readonly string[];
  repoCount: number;
  selectedPaths: readonly string[];
  activePath: string | null;
  activeStatus: RepoStatus | null;
  statuses: Record<string, RepoStatus>;
  busyAction: string | null;
  error: string | null;
  discovering: boolean;
  statusLoading: boolean;
  diffLoading: boolean;
  gitReady: boolean;
  diffFiles: readonly FileChange[];
  diffTruncated: boolean;
  logs: readonly BatchProgress[];
  dialogs: DevDialogs;
};

type ConsoleLine = {
  level: "error" | "warn";
  message: string;
  at: string;
};

type DevBridge = {
  lines: ConsoleLine[];
  latest: DevWorkspaceInput | null;
  pending: number | null;
  pushing: boolean;
  queued: boolean;
  wrapped: boolean;
  probed: boolean;
  remember: (level: ConsoleLine["level"], args: unknown[]) => void;
  schedule: () => void;
};

function devBridge(): DevBridge {
  const host = window as Window & { __ceGitDevFeedback?: DevBridge };
  if (!host.__ceGitDevFeedback) {
    host.__ceGitDevFeedback = {
      lines: [],
      latest: null,
      pending: null,
      pushing: false,
      queued: false,
      wrapped: false,
      probed: false,
      remember: () => {},
      schedule: () => {},
    };
  }
  return host.__ceGitDevFeedback;
}

export function installDevConsole() {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }
  const bridge = devBridge();
  bridge.remember = remember;
  bridge.schedule = schedulePush;
  if (bridge.wrapped) {
    return;
  }
  bridge.wrapped = true;
  const error = console.error.bind(console);
  const warn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    devBridge().remember("error", args);
    error(...args);
  };
  console.warn = (...args: unknown[]) => {
    devBridge().remember("warn", args);
    warn(...args);
  };
  window.addEventListener("error", (event) => {
    const message = event.error instanceof Error ? event.error.stack || event.error.message : event.message;
    devBridge().remember("error", [message]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    devBridge().remember("error", [event.reason]);
  });
  window.addEventListener("click", () => devBridge().schedule(), true);
  window.addEventListener("keyup", () => devBridge().schedule(), true);
  window.addEventListener("input", () => devBridge().schedule(), true);
  if (bridge.probed) {
    return;
  }
  bridge.probed = true;
  void invoke<boolean>("dev_feedback_probe")
    .then((enabled) => {
      if (enabled) {
        console.error("ce-git dev feedback probe");
      }
    })
    .catch(() => {
      // The command is absent outside the debug build.
    });
}

function remember(level: ConsoleLine["level"], args: unknown[]) {
  const lines = devBridge().lines;
  lines.push({
    level,
    message: formatArgs(args).slice(0, MESSAGE_LIMIT),
    at: new Date().toISOString(),
  });
  if (lines.length > CONSOLE_LIMIT) {
    lines.splice(0, lines.length - CONSOLE_LIMIT);
  }
  devBridge().schedule();
}

function formatArgs(args: unknown[]) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export function useDevFeedback(input: DevWorkspaceInput) {
  const signature = import.meta.env.DEV ? signatureOf(input) : "";
  if (import.meta.env.DEV) {
    devBridge().latest = input;
  }
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    devBridge().schedule();
  }, [signature]);
}

function schedulePush() {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }
  const bridge = devBridge();
  if (bridge.pending !== null) {
    window.clearTimeout(bridge.pending);
  }
  bridge.pending = window.setTimeout(() => {
    devBridge().pending = null;
    void flush();
  }, PUSH_DELAY_MS);
}

async function flush() {
  if (!import.meta.env.DEV) {
    return;
  }
  const bridge = devBridge();
  if (bridge.pushing) {
    bridge.queued = true;
    return;
  }
  bridge.pushing = true;
  try {
    const snapshot = {
      ready: true,
      title: document.title,
      updatedAt: new Date().toISOString(),
      workspace: bridge.latest ? workspaceSection(bridge.latest) : null,
      ui: collectUi(),
      console: bridge.lines.map((line) => ({ ...line })),
    };
    await invoke("dev_feedback_push", { snapshot });
  } catch {
    // The command exists only while the debug build is running.
  } finally {
    const current = devBridge();
    current.pushing = false;
    if (current.queued) {
      current.queued = false;
      current.schedule();
    }
  }
}

function signatureOf(input: DevWorkspaceInput) {
  return JSON.stringify(workspaceSection(input));
}

function workspaceSection(input: DevWorkspaceInput) {
  let dirtyCount = 0;
  let aheadCount = 0;
  let behindCount = 0;
  for (const status of Object.values(input.statuses)) {
    if (status.dirty) {
      dirtyCount += 1;
    }
    if (status.error) {
      continue;
    }
    if (status.ahead > 0) {
      aheadCount += 1;
    }
    if (status.behind > 0) {
      behindCount += 1;
    }
  }
  const status = input.activeStatus;
  return {
    rootPaths: [...input.rootPaths],
    repoCount: input.repoCount,
    selectedPaths: [...input.selectedPaths],
    activePath: input.activePath,
    activeStatus: status
      ? {
          path: status.path,
          name: status.name,
          branch: status.branch,
          detached: status.detached,
          upstream: status.upstream,
          ahead: status.ahead,
          behind: status.behind,
          dirty: status.dirty,
          staged: status.staged,
          unstaged: status.unstaged,
          untracked: status.untracked,
          defaultBranch: status.defaultBranch,
          hasCommits: status.hasCommits,
          error: status.error,
        }
      : null,
    dirtyCount,
    aheadCount,
    behindCount,
    busyAction: input.busyAction,
    error: input.error,
    discovering: input.discovering,
    statusLoading: input.statusLoading,
    diffLoading: input.diffLoading,
    gitReady: input.gitReady,
    diffFiles: input.diffFiles.slice(0, DIFF_FILE_LIMIT).map((file) => ({
      path: file.path,
      status: file.status,
      staged: file.staged,
    })),
    diffTruncated: input.diffTruncated || input.diffFiles.length > DIFF_FILE_LIMIT,
    logs: input.logs.slice(-LOG_LIMIT).map((row) => ({
      repo: row.repo,
      action: row.action,
      status: row.status,
      message: row.message.slice(0, 500),
    })),
    dialogs: input.dialogs,
  };
}

function collectUi() {
  const nodes: { id: string; tag: string; role: string | null; text: string; disabled: boolean }[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[id]")) {
    if (nodes.length >= UI_LIMIT) {
      break;
    }
    if (!isVisible(el)) {
      continue;
    }
    nodes.push({
      id: el.id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: ownText(el).replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    });
  }
  return nodes;
}

function isVisible(el: HTMLElement) {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function ownText(el: HTMLElement) {
  if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden")) {
    return "";
  }
  const labelled = el.getAttribute("aria-label")?.trim();
  if (labelled) {
    return labelled;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  const direct: string[] = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.trim();
      if (value) {
        direct.push(value);
      }
    }
  }
  if (direct.length > 0) {
    return direct.join(" ");
  }
  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLLabelElement ||
    el.getAttribute("role") === "button"
  ) {
    return el.textContent?.trim() ?? "";
  }
  return "";
}
