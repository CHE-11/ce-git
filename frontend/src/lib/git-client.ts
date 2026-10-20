import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  AiPrompts,
  AppSettings,
  BatchProgress,
  CommitRequest,
  CommitVerbosity,
  GeneratedCommit,
  GitSettings,
  OpenAiModel,
  RepoDiff,
  RepoSearchResult,
  RepoStatus,
  ThinkingMode,
  TreeNode,
} from "../../../types/git";

export function gitAvailable() {
  return invoke<boolean>("git_available");
}

export function gitSettings() {
  return invoke<GitSettings>("git_settings");
}

export function saveGitSettings(settings: {
  name: string;
  email: string;
  defaultBranch: string;
  autocrlf: string;
}) {
  return invoke<void>("save_git_settings", settings);
}

export function gitSignIn() {
  return invoke<GitSettings>("git_sign_in");
}

export function gitSignOut(account: string) {
  return invoke<GitSettings>("git_sign_out", { account });
}

export function gitCancelSignIn() {
  return invoke<void>("git_cancel_sign_in");
}

export function appSettings() {
  return invoke<AppSettings>("app_settings");
}

export function saveAppSettings(settings: {
  settingsFolder: string;
  fontZoom: number;
  theme: string;
  colorMode: "dark" | "light" | "system";
  selectedPrompt: number | null;
  prompts: AiPrompts;
  folderIgnore: string;
}) {
  return invoke<AppSettings>("save_app_settings", settings);
}

export function previewAppSettings(settingsFolder: string) {
  return invoke<AppSettings>("preview_app_settings", { settingsFolder });
}

export function themeCss() {
  return invoke<string>("theme_css");
}

export function patchAppSettings(patch: {
  fontZoom?: number;
  commitVerbosity?: CommitVerbosity;
  selectedPrompt?: number;
  clearSelectedPrompt?: boolean;
  rootPaths?: string[];
  removedRepos?: string[];
  folderIgnore?: string;
}) {
  return invoke<void>("patch_app_settings", { patch });
}

export function openaiConfigured() {
  return invoke<boolean>("openai_configured");
}

export function aiSettings() {
  return invoke<AiSettings>("ai_settings");
}

export function saveAiSettings(settings: {
  key: string;
  model: string;
  thinking: ThinkingMode;
  prompts: AiPrompts;
  clearKey: boolean;
}) {
  return invoke<void>("save_ai_settings", settings);
}

export function listOpenAiModels(key: string, include = "") {
  return invoke<OpenAiModel[]>("list_openai_models", { key, include });
}

export function discoverRepos(root: string) {
  return invoke<TreeNode>("discover_repos", { root });
}

export function repoStatuses(paths: string[]) {
  return invoke<RepoStatus[]>("repo_statuses", { paths });
}

export function repoDiff(path: string) {
  return invoke<RepoDiff>("repo_diff", { path });
}

export function searchRepos(request: {
  paths: string[];
  query: string;
  matchCase: boolean;
  regex: boolean;
  wholeWord: boolean;
  glob: string;
}) {
  return invoke<RepoSearchResult[]>("search_repos", request);
}

export function generateCommitMessage(path: string, prompt: string) {
  return invoke<GeneratedCommit>("generate_commit_message", { path, prompt });
}

export function batchPull(paths: string[]) {
  return invoke<BatchProgress[]>("batch_pull", { paths });
}

export function batchPush(paths: string[]) {
  return invoke<BatchProgress[]>("batch_push", { paths });
}

export function batchCommit(commits: CommitRequest[]) {
  return invoke<BatchProgress[]>("batch_commit", { commits });
}

export type FolderEditor = "default" | "code" | "cursor";

export function openInEditor(path: string, editor: FolderEditor = "default") {
  return invoke<void>("open_in_editor", { path, editor });
}

export function revealInExplorer(path: string) {
  return invoke<void>("reveal_in_explorer", { path });
}

export function initRepo(path: string) {
  return invoke<void>("init_repo", { path });
}

export function deleteFolder(root: string, path: string) {
  return invoke<void>("delete_path", { root, path });
}

export type IgnoreKind = "file" | "folder" | "extension";
export type ChangeOpenMode = "editor" | "cursor" | "default";

export function discardChange(repo: string, path: string) {
  return invoke<void>("discard_change", { repo, path });
}

export function ignoreChange(repo: string, kind: IgnoreKind, path: string) {
  return invoke<void>("ignore_change", { repo, kind, path });
}

export function revealChange(repo: string, path: string) {
  return invoke<void>("reveal_change", { repo, path });
}

export function openChange(repo: string, path: string, mode: ChangeOpenMode) {
  return invoke<void>("open_change", { repo, path, mode });
}
