export type TreeNodeKind = "folder" | "repo";

export interface TreeNode {
  name: string;
  path: string;
  kind: TreeNodeKind;
  children: TreeNode[];
}

export interface RepoStatus {
  path: string;
  name: string;
  branch: string;
  detached: boolean;
  upstream: string | null;
  /** True when origin is GitHub, false for another host, null when origin is missing. */
  github: boolean | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  defaultBranch: string | null;
  error: string | null;
}

export interface FileChange {
  path: string;
  previousPath?: string | null;
  status: string;
  staged: boolean;
}

export interface RepoDiff {
  files: FileChange[];
  patch: string;
  truncated: boolean;
}

export type BatchAction = "pull" | "push" | "commit";
export type BatchStatus = "running" | "ok" | "skipped" | "failed";

export interface BatchProgress {
  repo: string;
  action: BatchAction;
  status: BatchStatus;
  message: string;
}

export interface CommitRequest {
  path: string;
  message: string;
}

export type CommitVerbosity = "quick" | "descriptive";

export interface GeneratedCommit {
  subject: string;
  description: string;
}

export type ThinkingMode = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiModel {
  id: string;
  created: number;
  price: string;
}

export type AiPrompts = [string, string, string];

export interface AiSettings {
  configured: boolean;
  model: string;
  thinking: ThinkingMode;
  prompts: AiPrompts;
}

export interface GitSettings {
  gitAvailable: boolean;
  credentialManager: boolean;
  helperConfigured: boolean;
  name: string;
  email: string;
  defaultBranch: string;
  autocrlf: string;
  accounts: string[];
  accountsError: string | null;
}

export interface AiCommitDraft {
  path: string;
  name: string;
  message: string;
  description: string;
  error: string | null;
  include: boolean;
}

export interface AppSettings {
  settingsFolder: string;
  settingsFile: string;
  shared: boolean;
  warning: string | null;
  rootPaths: string[];
  removedRepos: string[];
  commitVerbosity: CommitVerbosity;
  selectedPrompt: number | null;
  fontZoom: number;
  model: string;
  thinking: ThinkingMode;
  prompts: AiPrompts;
}
