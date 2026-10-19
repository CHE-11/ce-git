import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent } from "react";
import type { RepoStatus, TreeNode } from "../../../types/git";
import { domId, repoMatchesFilter, type RepoTreeFilter } from "../lib/tree";
import { cn } from "../lib/cn";

type RepoTreeNodeProps = {
  node: TreeNode;
  depth: number;
  statuses: Record<string, RepoStatus>;
  selectedPaths: string[];
  activePath: string | null;
  collapsed: Record<string, boolean>;
  rootPath?: string | null;
  contextPath: string | null;
  filter: RepoTreeFilter | null;
  onToggle: (path: string) => void;
  onSelect: (path: string, mode: "replace" | "toggle" | "range") => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
};

export function RepoTreeNode({
  node,
  depth,
  statuses,
  selectedPaths,
  activePath,
  collapsed,
  rootPath,
  contextPath,
  filter,
  onToggle,
  onSelect,
  onContextMenu,
}: RepoTreeNodeProps) {
  const rowId = domId("tree-row", node.path);
  const isRepo = node.kind === "repo";
  const status = isRepo ? statuses[node.path] : undefined;
  const selected = isRepo && selectedPaths.includes(node.path);
  const active = node.path === activePath;
  const expanded = !collapsed[node.path];
  const hasChildren = node.children.length > 0;
  const showRootPath = depth === 0 && Boolean(rootPath);
  const targeted = node.path === contextPath;
  const dimmed = filter !== null && isRepo && !repoMatchesFilter(node.path, statuses, selectedPaths, filter);

  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!isRepo) {
      if (hasChildren) {
        onToggle(node.path);
      }
      return;
    }
    if (event.shiftKey) {
      onSelect(node.path, "range");
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      onSelect(node.path, "toggle");
      return;
    }
    onSelect(node.path, "replace");
  };

  return (
    <div id={domId("tree-node", node.path)}>
      <div
        id={rowId}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-zinc-800/80",
          active && "bg-sky-950/70",
          selected && !active && "bg-zinc-800",
          targeted && "ring-1 ring-inset ring-sky-800",
          dimmed && "opacity-50",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onMouseDown={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
          }
        }}
        onClick={onRowClick}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event.clientX, event.clientY);
        }}
      >
        {hasChildren ? (
          <button
            id={domId("tree-toggle", node.path)}
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-zinc-500"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.path);
            }}
          >
            {expanded ? (
              <ChevronDown id={domId("tree-chevron", node.path)} className="size-3.5" />
            ) : (
              <ChevronRight id={domId("tree-chevron", node.path)} className="size-3.5" />
            )}
          </button>
        ) : (
          <span id={domId("tree-spacer", node.path)} className="size-4 shrink-0" />
        )}
        {isRepo ? (
          <input
            id={domId("tree-check", node.path)}
            type="checkbox"
            className="size-3.5 shrink-0 accent-sky-500"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onSelect(node.path, "toggle")}
          />
        ) : null}
        <span id={domId("tree-name", node.path)} className="shrink-0 text-zinc-100" title={node.path}>
          {node.name}
        </span>
        {showRootPath || status ? (
          <span id={domId("tree-aside", node.path)} className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
            {showRootPath ? (
              <span
                id={domId("tree-root-path", node.path)}
                className="min-w-0 truncate text-right text-xs text-zinc-500"
                title={rootPath ?? ""}
              >
                {rootPath}
              </span>
            ) : null}
            {status ? (
              <span id={domId("tree-meta", node.path)} className="flex shrink-0 items-center gap-1.5 text-xs">
                <span id={domId("tree-branch", node.path)} className="text-zinc-500">
                  {status.branch}
                </span>
                {status.ahead > 0 ? (
                  <span id={domId("tree-ahead", node.path)} className="text-emerald-400">
                    ↑{status.ahead}
                  </span>
                ) : null}
                {status.behind > 0 ? (
                  <span id={domId("tree-behind", node.path)} className="text-sky-400">
                    ↓{status.behind}
                  </span>
                ) : null}
                {status.github === null && !status.error ? (
                  <span id={domId("tree-unpublished", node.path)} className="text-violet-300" title="No remote">
                    unpublished
                  </span>
                ) : null}
                {status.dirty ? (
                  <span
                    id={domId("tree-dirty", node.path)}
                    className="size-2 rounded-full bg-amber-400"
                    title="Uncommitted changes"
                  />
                ) : null}
                {status.error ? (
                  <span id={domId("tree-error", node.path)} className="text-red-400" title={status.error}>
                    !
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {expanded
        ? node.children.map((child) => (
            <RepoTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              statuses={statuses}
              selectedPaths={selectedPaths}
              activePath={activePath}
              collapsed={collapsed}
              contextPath={contextPath}
              filter={filter}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))
        : null}
    </div>
  );
}
