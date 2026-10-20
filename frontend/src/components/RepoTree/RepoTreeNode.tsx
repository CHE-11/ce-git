import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { RepoStatus, TreeNode } from "../../../../types/git";
import { domId, repoMatchesFilter, type RepoTreeFilter } from "../../lib/tree";
import { cn } from "../../lib/cn";

type RepoTreeNodeProps = {
  node: TreeNode;
  depth: number;
  statuses: Record<string, RepoStatus>;
  activePath: string | null;
  collapsed: Record<string, boolean>;
  rootPath?: string | null;
  contextPath: string | null;
  filter: RepoTreeFilter | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  allowRootCollapse?: boolean;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  trailing?: ReactNode;
};

export function RepoTreeNode({
  node,
  depth,
  statuses,
  activePath,
  collapsed,
  rootPath,
  contextPath,
  filter,
  onToggle,
  onOpen,
  onContextMenu,
  trailing,
  allowRootCollapse = true,
}: RepoTreeNodeProps) {
  const rowId = domId("tree-row", node.path);
  const isRepo = node.kind === "repo";
  const status = isRepo ? statuses[node.path] : undefined;
  const active = node.path === activePath;
  const rootLockedOpen = depth === 0 && !allowRootCollapse;
  const expanded = rootLockedOpen || !collapsed[node.path];
  const hasChildren = node.children.length > 0;
  const canToggle = hasChildren && !rootLockedOpen;
  const showRootPath = depth === 0 && Boolean(rootPath);
  const targeted = node.path === contextPath;
  const dimmed = filter !== null && isRepo && !repoMatchesFilter(node.path, statuses, [], filter);

  const onRowClick = () => {
    if (!isRepo) {
      if (canToggle) {
        onToggle(node.path);
      }
      return;
    }
    onOpen(node.path);
  };

  return (
    <div id={domId("tree-node", node.path)}>
      <div
        id={rowId}
        className={cn(
          "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-zinc-800/80",
          (isRepo || canToggle) && "cursor-pointer",
          active && "bg-sky-950/70",
          targeted && "ring-1 ring-inset ring-sky-800",
          dimmed && "opacity-50",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onRowClick}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event.clientX, event.clientY);
        }}
      >
        {canToggle ? (
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
        <span id={domId("tree-name", node.path)} className="shrink-0 text-zinc-100" title={node.path}>
          {node.name}
        </span>
        {showRootPath || status || trailing ? (
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
            {trailing ? (
              <span id={domId("tree-trailing", node.path)} className="shrink-0">
                {trailing}
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
              activePath={activePath}
              collapsed={collapsed}
              contextPath={contextPath}
              filter={filter}
              onToggle={onToggle}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))
        : null}
    </div>
  );
}
