import type { RepoStatus, TreeNode } from "../../../types/git";

export type RepoTreeFilter = "dirty" | "ahead" | "behind" | "unpublished" | "selected";

export function collectRepos(node: TreeNode): TreeNode[] {
  const own = node.kind === "repo" ? [node] : [];
  return [...own, ...node.children.flatMap((child) => collectRepos(child))];
}

export function normalizePath(value: string) {
  return value.replaceAll("/", "\\").replace(/\\+$/g, "").toLowerCase();
}

export function pathEquals(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

export function pathIsInside(parent: string, child: string) {
  const root = normalizePath(parent);
  const path = normalizePath(child);
  return path.startsWith(`${root}\\`);
}

export function containingRoot(roots: readonly string[], path: string) {
  return roots.find((root) => pathEquals(root, path) || pathIsInside(root, path)) ?? null;
}

export function countRemovedUnder(root: string | readonly string[] | null, removed: readonly string[]) {
  const roots = typeof root === "string" ? [root] : root ? [...root] : [];
  if (roots.length === 0) {
    return 0;
  }
  return removed.filter((path) => roots.some((item) => pathEquals(path, item) || pathIsInside(item, path))).length;
}

export function hasNestedRepo(node: TreeNode): boolean {
  return node.children.some((child) => child.kind === "repo" || hasNestedRepo(child));
}

const MAX_FOLDER_IGNORE_CHARS = 16 * 1024;

export function folderIgnoreError(patternText: string) {
  if (patternText.length > MAX_FOLDER_IGNORE_CHARS) {
    return "Folder patterns are limited to 16 KB.";
  }
  const lines = patternText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      new RegExp(line, "i");
    } catch {
      return `Line ${index + 1} is not a valid regular expression.`;
    }
  }
  return null;
}

export function hideIgnoredFolders(tree: TreeNode, patternText: string): TreeNode | null {
  const patterns = compileFolderIgnore(patternText);
  if (patterns.length === 0) {
    return tree;
  }
  return pruneIgnored(tree, patterns);
}

function compileFolderIgnore(patternText: string) {
  const patterns: RegExp[] = [];
  for (const line of patternText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      patterns.push(new RegExp(trimmed, "i"));
    } catch {
      // A line that is not a valid expression hides nothing.
    }
  }
  return patterns;
}

function folderMatchesIgnore(node: TreeNode, patterns: readonly RegExp[]) {
  const path = node.path;
  const portable = path.replaceAll("\\", "/");
  return patterns.some((pattern) => pattern.test(node.name) || pattern.test(path) || pattern.test(portable));
}

function pruneIgnored(node: TreeNode, patterns: readonly RegExp[]): TreeNode | null {
  if (folderMatchesIgnore(node, patterns)) {
    return null;
  }
  let childrenChanged = false;
  const children: TreeNode[] = [];
  for (const child of node.children) {
    const next = pruneIgnored(child, patterns);
    if (next !== child) {
      childrenChanged = true;
    }
    if (next) {
      children.push(next);
    }
  }
  if (!childrenChanged) {
    return node;
  }
  if (node.kind === "folder" && children.length === 0) {
    return null;
  }
  return { name: node.name, path: node.path, kind: node.kind, children };
}

export function hideRemovedRepos(tree: TreeNode, removed: readonly string[]): TreeNode {
  if (removed.length === 0) {
    return tree;
  }
  const hidden = new Set(removed.map(normalizePath));
  return (
    pruneRemoved(tree, hidden) ?? {
      name: tree.name,
      path: tree.path,
      kind: "folder",
      children: [],
    }
  );
}

function pruneRemoved(node: TreeNode, hidden: ReadonlySet<string>): TreeNode | null {
  if (node.kind === "folder" && hidden.has(normalizePath(node.path))) {
    return null;
  }

  let childrenChanged = false;
  const children: TreeNode[] = [];
  for (const child of node.children) {
    const next = pruneRemoved(child, hidden);
    if (next !== child) {
      childrenChanged = true;
    }
    if (next) {
      children.push(next);
    }
  }

  const removed = node.kind === "repo" && hidden.has(normalizePath(node.path));
  if (!removed && !childrenChanged) {
    return node;
  }

  const kind = removed ? "folder" : node.kind;
  if (kind === "folder" && children.length === 0) {
    return null;
  }

  return { name: node.name, path: node.path, kind, children };
}

export function repoMatchesFilter(
  path: string,
  statuses: Record<string, RepoStatus>,
  selectedPaths: readonly string[],
  filter: RepoTreeFilter,
) {
  if (filter === "selected") {
    return selectedPaths.some((selected) => pathEquals(selected, path));
  }
  const status = statuses[path];
  if (!status) {
    return false;
  }
  if (filter === "dirty") {
    return status.dirty;
  }
  if (filter === "ahead") {
    return status.ahead > 0;
  }
  if (filter === "unpublished") {
    return status.github === null && !status.error;
  }
  return status.behind > 0;
}

export function filterRepoTree(
  tree: TreeNode,
  statuses: Record<string, RepoStatus>,
  selectedPaths: readonly string[],
  filter: RepoTreeFilter,
): TreeNode {
  return (
    pruneToFilter(tree, statuses, selectedPaths, filter) ?? {
      name: tree.name,
      path: tree.path,
      kind: "folder",
      children: [],
    }
  );
}

function pruneToFilter(
  node: TreeNode,
  statuses: Record<string, RepoStatus>,
  selectedPaths: readonly string[],
  filter: RepoTreeFilter,
): TreeNode | null {
  let childrenChanged = false;
  const children: TreeNode[] = [];
  for (const child of node.children) {
    const next = pruneToFilter(child, statuses, selectedPaths, filter);
    if (next !== child) {
      childrenChanged = true;
    }
    if (next) {
      children.push(next);
    }
  }

  const matches = node.kind === "repo" && repoMatchesFilter(node.path, statuses, selectedPaths, filter);
  if (!matches && children.length === 0) {
    return null;
  }
  if (!childrenChanged) {
    return node;
  }
  return { name: node.name, path: node.path, kind: node.kind, children };
}

export function findTreeNode(nodes: readonly TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (pathEquals(node.path, path)) {
      return node;
    }
    const nested = findTreeNode(node.children, path);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export type HiddenTreeItem = {
  path: string;
  name: string;
  kind: TreeNode["kind"] | null;
};

export function hiddenTreeItems(trees: readonly TreeNode[], removed: readonly string[], roots: readonly string[]): HiddenTreeItem[] {
  return removed
    .filter((path) => containingRoot(roots, path))
    .map((path) => {
      const node = findTreeNode(trees, path);
      return {
        path,
        name: node?.name ?? baseName(path),
        kind: node?.kind ?? null,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));
}

export function baseName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function messageOf(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

export function pickedFolderPath(picked: unknown): string | null {
  const value = Array.isArray(picked) ? picked[0] : picked;
  if (typeof value === "string") {
    return normalizePickedPath(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["path", "Path", "folder", "Folder"]) {
      if (typeof record[key] === "string") {
        return normalizePickedPath(record[key]);
      }
    }
  }
  return null;
}

function normalizePickedPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.toLowerCase().startsWith("file:")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(path)) {
      path = path.slice(1).replace(/\//g, "\\");
    }
    return path;
  } catch {
    return trimmed;
  }
}

export function domId(prefix: string, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${prefix}-${slug || "item"}-${hash.toString(36)}`;
}
