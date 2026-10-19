import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RepoSearchResult, SearchMatch, TreeNode } from "../../../../types/git";
import { searchRepos } from "../../lib/git-client";
import { cn } from "../../lib/cn";
import { collectRepos, domId, messageOf, pathEquals } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

type AdvancedSearchDialogProps = {
  open: boolean;
  trees: TreeNode[];
  initialSelected: string[];
  onClose: () => void;
  onOpenMatch: (repo: string, file: string) => void;
};

type HighlightPart = {
  index: number;
  match: boolean;
  text: string;
};

const fieldClass =
  "min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

function filterTree(node: TreeNode, query: string): TreeNode | null {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return node;
  }
  const self = node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle);
  if (self) {
    return node;
  }
  const children = node.children.flatMap((child) => {
    const next = filterTree(child, needle);
    return next ? [next] : [];
  });
  if (children.length === 0) {
    return null;
  }
  return { name: node.name, path: node.path, kind: node.kind, children };
}

function includesPath(paths: readonly string[], path: string) {
  return paths.some((item) => pathEquals(item, path));
}

function splitHighlight(text: string, query: string, matchCase: boolean, regex: boolean): HighlightPart[] {
  const source = query.trim();
  if (!source) {
    return [{ index: 0, match: false, text }];
  }
  let pattern: RegExp;
  try {
    const body = regex ? source : source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(body, matchCase ? "g" : "gi");
  } catch {
    return [{ index: 0, match: false, text }];
  }
  const parts: HighlightPart[] = [];
  let last = 0;
  let guard = 0;
  for (const found of text.matchAll(pattern)) {
    const index = found.index ?? 0;
    const value = found[0];
    if (value.length === 0) {
      break;
    }
    if (index > last) {
      parts.push({ index: last, match: false, text: text.slice(last, index) });
    }
    parts.push({ index, match: true, text: value });
    last = index + value.length;
    guard += 1;
    if (guard > 50) {
      break;
    }
  }
  if (parts.length > 0 && last < text.length) {
    parts.push({ index: last, match: false, text: text.slice(last) });
  }
  if (parts.length === 0) {
    return [{ index: 0, match: false, text }];
  }
  return parts;
}

function groupMatches(matches: SearchMatch[]) {
  const groups: { path: string; matches: SearchMatch[] }[] = [];
  for (const match of matches) {
    const current = groups[groups.length - 1];
    if (current && current.path === match.path) {
      current.matches.push(match);
    } else {
      groups.push({ path: match.path, matches: [match] });
    }
  }
  return groups;
}

function HighlightedLine({ id, text, query, matchCase, regex }: { id: string; text: string; query: string; matchCase: boolean; regex: boolean }) {
  const parts = splitHighlight(text, query, matchCase, regex);
  return (
    <span id={id} className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
      {parts.map((part) =>
        part.match ? (
          <mark id={`${id}-mark-${part.index}`} key={`${part.index}-mark`} className="rounded-sm bg-amber-400/30 text-amber-100">
            {part.text}
          </mark>
        ) : (
          <span id={`${id}-text-${part.index}`} key={`${part.index}-text`}>
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

function SearchToggle({ id, pressed, label, title, onClick }: { id: string; pressed: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        "h-7 rounded-md border px-2 font-mono text-xs",
        pressed ? "border-sky-600 bg-sky-950/60 text-sky-100" : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-800",
      )}
    >
      <span id={`${id}-label`}>{label}</span>
    </button>
  );
}

type SearchTreeNodeProps = {
  node: TreeNode;
  depth: number;
  selected: string[];
  collapsed: Record<string, boolean>;
  onToggleCollapse: (path: string) => void;
  onToggleRepo: (path: string) => void;
  onToggleFolder: (node: TreeNode) => void;
};

function SearchTreeNode({ node, depth, selected, collapsed, onToggleCollapse, onToggleRepo, onToggleFolder }: SearchTreeNodeProps) {
  const repos = node.kind === "folder" ? collectRepos(node) : [node];
  const checkedCount = repos.filter((repo) => includesPath(selected, repo.path)).length;
  const checked = repos.length > 0 && checkedCount === repos.length;
  const indeterminate = checkedCount > 0 && checkedCount < repos.length;
  const expanded = !collapsed[node.path];
  const hasChildren = node.children.length > 0;
  const rowId = domId("advanced-search-row", node.path);

  return (
    <div id={domId("advanced-search-node", node.path)}>
      <div
        id={rowId}
        className="flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-zinc-800/80"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (node.kind === "repo") {
            onToggleRepo(node.path);
          } else if (hasChildren) {
            onToggleCollapse(node.path);
          }
        }}
      >
        {hasChildren ? (
          <button
            id={domId("advanced-search-expand", node.path)}
            type="button"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.path);
            }}
            className="inline-flex size-3.5 shrink-0 items-center justify-center text-zinc-500"
          >
            {expanded ? (
              <ChevronDown id={domId("advanced-search-expand-icon", node.path)} className="size-3.5" />
            ) : (
              <ChevronRight id={domId("advanced-search-expand-icon", node.path)} className="size-3.5" />
            )}
          </button>
        ) : (
          <span id={domId("advanced-search-spacer", node.path)} className="inline-block size-3.5 shrink-0" />
        )}
        {repos.length > 0 ? (
          <input
            id={domId("advanced-search-check", node.path)}
            type="checkbox"
            checked={checked}
            ref={(element) => {
              if (element) {
                element.indeterminate = indeterminate;
              }
            }}
            aria-label={`Include ${node.name}`}
            onClick={(event) => event.stopPropagation()}
            onChange={() => {
              if (node.kind === "repo") {
                onToggleRepo(node.path);
              } else {
                onToggleFolder(node);
              }
            }}
            className="size-3.5 shrink-0 accent-sky-500"
          />
        ) : (
          <span id={domId("advanced-search-check-spacer", node.path)} className="inline-block size-3.5 shrink-0" />
        )}
        <span id={domId("advanced-search-name", node.path)} className="truncate text-zinc-200" title={node.path}>
          {node.name}
        </span>
      </div>
      {hasChildren && expanded
        ? node.children.map((child) => (
            <SearchTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onToggleRepo={onToggleRepo}
              onToggleFolder={onToggleFolder}
            />
          ))
        : null}
    </div>
  );
}

function SearchResults({
  results,
  query,
  matchCase,
  regex,
  onOpenMatch,
}: {
  results: RepoSearchResult[];
  query: string;
  matchCase: boolean;
  regex: boolean;
  onOpenMatch: (repo: string, file: string) => void;
}) {
  const listed = results.filter((repo) => repo.matches.length > 0 || repo.error);
  if (listed.length === 0) {
    return (
      <p id="advanced-search-empty" className="px-4 py-8 text-sm text-zinc-500">
        No matches.
      </p>
    );
  }

  return (
    <div id="advanced-search-results" className="flex flex-col gap-4 px-3 py-3">
      {listed.map((repo) => {
        const files = groupMatches(repo.matches);
        return (
          <section id={domId("advanced-search-repo", repo.path)} key={repo.path}>
            <div id={domId("advanced-search-repo-header", repo.path)} className="mb-1 px-1">
              <h3 id={domId("advanced-search-repo-name", repo.path)} className="text-sm font-medium text-zinc-100">
                {repo.name}
              </h3>
              <p id={domId("advanced-search-repo-path", repo.path)} className="truncate text-xs text-zinc-500" title={repo.path}>
                {repo.path}
              </p>
            </div>
            {repo.error ? (
              <p id={domId("advanced-search-repo-error", repo.path)} className="px-1 text-sm text-red-400">
                {repo.error}
              </p>
            ) : null}
            {files.map((file) => (
              <div id={domId("advanced-search-file", `${repo.path}:${file.path}`)} key={file.path} className="mt-1">
                <p
                  id={domId("advanced-search-file-path", `${repo.path}:${file.path}`)}
                  className="truncate px-1 py-1 font-mono text-xs text-zinc-400"
                  title={file.path}
                >
                  {file.path}
                </p>
                {file.matches.map((match) => {
                  const hitId = domId("advanced-search-hit", `${repo.path}:${match.path}:${match.line}`);
                  return (
                    <button
                      id={hitId}
                      key={`${match.path}:${match.line}:${match.text}`}
                      type="button"
                      onClick={() => onOpenMatch(repo.path, match.path)}
                      className="flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left hover:bg-zinc-800"
                    >
                      <span id={`${hitId}-line`} className="w-10 shrink-0 text-right font-mono text-xs text-zinc-500">
                        {match.line}
                      </span>
                      <HighlightedLine id={`${hitId}-text`} text={match.text} query={query} matchCase={matchCase} regex={regex} />
                    </button>
                  );
                })}
              </div>
            ))}
            {repo.truncated ? (
              <p id={domId("advanced-search-repo-truncated", repo.path)} className="px-1 pt-1 text-xs text-amber-300">
                First 200 matches.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function AdvancedSearchDialog({ open, trees, initialSelected, onClose, onOpenMatch }: AdvancedSearchDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeQuery, setTreeQuery] = useState("");
  const [query, setQuery] = useState("");
  const [glob, setGlob] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RepoSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const treesRef = useRef(trees);
  const initialRef = useRef(initialSelected);
  treesRef.current = trees;
  initialRef.current = initialSelected;

  useEffect(() => {
    if (!open) {
      generation.current += 1;
      setSearching(false);
      return;
    }
    const repos = treesRef.current.flatMap((tree) => collectRepos(tree));
    const seeded = repos.filter((repo) => includesPath(initialRef.current, repo.path)).map((repo) => repo.path);
    setSelected(seeded.length > 0 ? seeded : repos.map((repo) => repo.path));
    setCollapsed({});
    setTreeQuery("");
    setResults(null);
    setError(null);
  }, [open]);

  const repos = useMemo(() => trees.flatMap((tree) => collectRepos(tree)), [trees]);
  const selectedCount = repos.filter((repo) => includesPath(selected, repo.path)).length;
  const shownTrees = useMemo(
    () =>
      trees.flatMap((tree) => {
        const next = filterTree(tree, treeQuery);
        return next ? [next] : [];
      }),
    [trees, treeQuery],
  );
  const collapsedNow = treeQuery.trim() ? {} : collapsed;
  const matchCount = results?.reduce((sum, repo) => sum + repo.matches.length, 0) ?? 0;
  const reposWithMatches = results?.filter((repo) => repo.matches.length > 0).length ?? 0;

  const requestClose = () => {
    generation.current += 1;
    setSearching(false);
    onClose();
  };

  const toggleRepo = (path: string) => {
    setSelected((current) => (includesPath(current, path) ? current.filter((item) => !pathEquals(item, path)) : [...current, path]));
  };

  const toggleFolder = (node: TreeNode) => {
    const folderRepos = collectRepos(node);
    setSelected((current) => {
      const allOn = folderRepos.every((repo) => includesPath(current, repo.path));
      if (allOn) {
        return current.filter((path) => !folderRepos.some((repo) => pathEquals(repo.path, path)));
      }
      const next = [...current];
      for (const repo of folderRepos) {
        if (!includesPath(next, repo.path)) {
          next.push(repo.path);
        }
      }
      return next;
    });
  };

  const runSearch = async () => {
    const queryText = query.trim();
    const paths = repos.map((repo) => repo.path).filter((path) => includesPath(selected, path));
    if (!queryText || paths.length === 0) {
      return;
    }
    const id = generation.current + 1;
    generation.current = id;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const next = await searchRepos({
        paths,
        query: queryText,
        matchCase,
        regex,
        wholeWord,
        glob: glob.trim(),
      });
      if (generation.current !== id) {
        return;
      }
      setResults(next);
    } catch (caught) {
      if (generation.current !== id) {
        return;
      }
      setError(messageOf(caught));
    } finally {
      if (generation.current === id) {
        setSearching(false);
      }
    }
  };

  return (
    <Dialog
      id="advanced-search-dialog"
      title="Advanced search"
      open={open}
      onClose={requestClose}
      panelClassName="h-[min(780px,86vh)] max-h-[86vh] max-w-6xl"
      bodyClassName="overflow-hidden p-0"
    >
      <div id="advanced-search-layout" className="flex h-full min-h-0">
        <aside id="advanced-search-tree" className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
          <div id="advanced-search-tree-header" className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <span id="advanced-search-selected-count" className="text-xs text-zinc-400">
              {selectedCount} of {repos.length} selected
            </span>
            <Button id="advanced-search-select-all" size="xs" variant="ghost" onClick={() => setSelected(repos.map((repo) => repo.path))} disabled={repos.length === 0}>
              <span id="advanced-search-select-all-label">All</span>
            </Button>
            <Button id="advanced-search-clear" size="xs" variant="ghost" onClick={() => setSelected([])} disabled={selectedCount === 0}>
              <span id="advanced-search-clear-label">None</span>
            </Button>
          </div>
          <div id="advanced-search-tree-filter-row" className="border-b border-zinc-800 px-3 py-2">
            <input
              id="advanced-search-tree-filter"
              type="search"
              value={treeQuery}
              onChange={(event) => setTreeQuery(event.target.value)}
              placeholder="Filter repositories"
              autoComplete="off"
              spellCheck={false}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div id="advanced-search-tree-list" className="min-h-0 flex-1 overflow-auto px-1 py-1">
            {repos.length === 0 ? (
              <p id="advanced-search-tree-empty" className="px-2 py-4 text-sm text-zinc-500">
                No repositories in the workspace.
              </p>
            ) : shownTrees.length === 0 ? (
              <p id="advanced-search-tree-filter-empty" className="px-2 py-4 text-sm text-zinc-500">
                No repositories match “{treeQuery.trim()}”.
              </p>
            ) : (
              shownTrees.map((tree) => (
                <SearchTreeNode
                  key={tree.path}
                  node={tree}
                  depth={0}
                  selected={selected}
                  collapsed={collapsedNow}
                  onToggleCollapse={(path) => setCollapsed((current) => ({ ...current, [path]: !current[path] }))}
                  onToggleRepo={toggleRepo}
                  onToggleFolder={toggleFolder}
                />
              ))
            )}
          </div>
        </aside>
        <section id="advanced-search-main" className="flex min-w-0 flex-1 flex-col">
          <form
            id="advanced-search-form"
            className="border-b border-zinc-800 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <div id="advanced-search-query-row" className="flex gap-2">
              <input
                id="advanced-search-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search file contents"
                autoComplete="off"
                spellCheck={false}
                className={`${fieldClass} flex-1`}
              />
              <Button id="advanced-search-submit" type="submit" variant="primary" disabled={query.trim().length === 0 || selectedCount === 0}>
                <Search id="advanced-search-submit-icon" className="size-4" />
                <span id="advanced-search-submit-label">{searching ? "Searching…" : "Search"}</span>
              </Button>
            </div>
            <div id="advanced-search-options" className="mt-2 flex flex-wrap items-center gap-2">
              <SearchToggle id="advanced-search-match-case" pressed={matchCase} label="Aa" title="Match case" onClick={() => setMatchCase((value) => !value)} />
              <SearchToggle id="advanced-search-regex" pressed={regex} label=".*" title="Use regular expression" onClick={() => setRegex((value) => !value)} />
              <SearchToggle id="advanced-search-whole-word" pressed={wholeWord} label="W" title="Match whole word" onClick={() => setWholeWord((value) => !value)} />
              <label id="advanced-search-glob-label" htmlFor="advanced-search-glob" className="text-xs text-zinc-500">
                Files
              </label>
              <input
                id="advanced-search-glob"
                value={glob}
                onChange={(event) => setGlob(event.target.value)}
                placeholder="*.ts"
                autoComplete="off"
                spellCheck={false}
                className={`${fieldClass} w-40`}
              />
            </div>
          </form>
          <div id="advanced-search-summary-row" className="border-b border-zinc-800 px-4 py-2">
            <p id="advanced-search-summary" className="text-xs text-zinc-500">
              {searching ? "Searching…" : results ? `${matchCount} matches in ${reposWithMatches} repos` : "Search file contents in the selected repositories."}
            </p>
          </div>
          <div id="advanced-search-output" className="min-h-0 flex-1 overflow-auto">
            {error ? (
              <p id="advanced-search-error" className="px-4 py-3 text-sm text-red-400">
                {error}
              </p>
            ) : null}
            {results ? (
              <SearchResults results={results} query={query} matchCase={matchCase} regex={regex} onOpenMatch={onOpenMatch} />
            ) : searching || error ? null : (
              <p id="advanced-search-hint" className="px-4 py-8 text-sm text-zinc-500">
                Choose repositories, then search. A match opens that file in the editor.
              </p>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
