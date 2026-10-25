export type TreeNodeKind = "folder" | "repo";

export interface TreeNode {
  name: string;
  path: string;
  kind: TreeNodeKind;
  children: TreeNode[];
}

export type DirKind = "file" | "folder";

export interface DirEntry {
  name: string;
  relativePath: string;
  kind: DirKind;
}

export interface DirSearch {
  entries: DirEntry[];
  truncated: boolean;
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
  hasCommits: boolean;
  error: string | null;
}

export interface FileChange {
  path: string;
  previousPath?: string | null;
  status: string;
  staged: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface RepoSearchResult {
  path: string;
  name: string;
  matches: SearchMatch[];
  truncated: boolean;
  error: string | null;
}

export interface RepoDiff {
  files: FileChange[];
  patch: string;
  truncated: boolean;
}

export type BatchAction = "pull" | "push" | "commit" | "publish";

export type RepoVisibility = "private" | "public" | "internal";

export interface PublishOptions {
  name: string;
  description: string;
  visibility: RepoVisibility;
  homepage: string;
}
export type BatchStatus = "running" | "ok" | "skipped" | "failed" | "conflict";

export interface BatchProgress {
  repo: string;
  path: string;
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

export interface GithubRepo {
  name: string;
  url: string;
  description: string;
  private: boolean;
}

export interface GithubRepos {
  accounts: string[];
  account: string;
  repos: GithubRepo[];
  truncated: boolean;
  notice: string | null;
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
  /** Repository opened most recently. Empty when none has been opened. */
  lastOpenedRepo: string;
  commitVerbosity: CommitVerbosity;
  selectedPrompt: number | null;
  fontZoom: number;
  theme: string;
  colorMode: "dark" | "light" | "system";
  toolbarLabels: boolean;
  defaultEditor: string;
  menuEditors: string[];
  model: string;
  thinking: ThinkingMode;
  prompts: AiPrompts;
  /** One regular expression per line. Matching folders are hidden in the repository tree. */
  folderIgnore: string;
}

export type GraphRefKind = "head" | "branch" | "remote" | "tag";

export interface GraphRef {
  name: string;
  kind: GraphRefKind;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  refs: GraphRef[];
}

export interface RepoGraph {
  head: string | null;
  commits: GraphCommit[];
  truncated: boolean;
}
