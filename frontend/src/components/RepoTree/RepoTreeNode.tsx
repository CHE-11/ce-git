import { ChevronDown, ChevronRight } from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { RepoStatus, TreeNode } from "../../../../types/git";
import { domId, repoMatchesFilter, type RepoTreeFilter } from "../../lib/tree";
import { cn } from "../../lib/cn";

function rowPadding(depth: number) {
  return depth === 0 ? 8 : 8 + depth * 14 - 18;
}

function guideLeft(depth: number) {
  return rowPadding(depth + 1) + 8;
}

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
  onViewRepo: (path: string) => void;
  allowRootCollapse?: boolean;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  folderVars: Map<string, string> | null;
  folderColorMode: "background" | "font" | null;
  folderIndicator: boolean;
  dirtyFolders: ReadonlySet<string>;
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
  onViewRepo,
  onContextMenu,
  folderVars,
  folderColorMode,
  folderIndicator,
  dirtyFolders,
  trailing,
  allowRootCollapse = true,
}: RepoTreeNodeProps) {
  const rowId = domId("tree-row", node.path);
  const isRepo = node.kind === "repo";
  const status = isRepo ? statuses[node.path] : undefined;
  const active = node.path === activePath;
  const rootLockedOpen = depth === 0 && !allowRootCollapse;
  const showGuide = folderIndicator && !rootLockedOpen;
  const expanded = rootLockedOpen || !collapsed[node.path];
  const hasChildren = node.children.length > 0;
  const canToggle = hasChildren && !rootLockedOpen;
  const showRootPath = depth === 0 && Boolean(rootPath);
  const folderDirty = !isRepo && dirtyFolders.has(node.path);
  const targeted = node.path === contextPath;
  const dimmed = filter !== null && isRepo && !repoMatchesFilter(node.path, statuses, [], filter);
  const folderVar = folderVars?.get(node.path) ?? null;
  const tintBackground = folderColorMode === "background" && folderVar !== null;
  const tintFont = folderColorMode === "font" && folderVar !== null;
  const nodeStyle: CSSProperties | undefined = folderVar
    ? ({ "--tree-folder": `var(${folderVar})` } as CSSProperties)
    : undefined;

  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail > 1) {
      return;
    }
    if (depth === 0) {
      if (isRepo) {
        onOpen(node.path);
      }
      return;
    }
    if (!isRepo) {
      if (canToggle) {
        onToggle(node.path);
      }
      return;
    }
    onOpen(node.path);
  };

  const onRowDoubleClick = () => {
    if (isRepo) {
      onViewRepo(node.path);
    }
  };

  const onRootLabelClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (!canToggle) {
      return;
    }
    event.stopPropagation();
    if (event.detail > 1) {
      return;
    }
    onToggle(node.path);
  };

  return (
    <div id={domId("tree-node", node.path)} className="relative" style={nodeStyle}>
      <div
        id={rowId}
        className={cn(
          "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm select-none",
          !tintBackground && "hover:bg-zinc-800/80",
          (isRepo || (canToggle && depth > 0)) && "cursor-pointer",
          !tintBackground && active && "bg-sky-950/70",
          tintBackground && "tree-folder-bg",
          tintBackground && active && "tree-folder-active",
          targeted && "ring-1 ring-inset ring-sky-800",
          dimmed && "opacity-50",
        )}
        style={{ paddingLeft: rowPadding(depth) }}
        onClick={onRowClick}
        onDoubleClick={onRowDoubleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event.clientX, event.clientY);
        }}
      >
        {depth > 0 && canToggle ? (
          <button
            id={domId("tree-toggle", node.path)}
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-zinc-500"
            onClick={(event) => {
              event.stopPropagation();
              if (event.detail > 1) {
                return;
              }
              onToggle(node.path);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {expanded ? (
              <ChevronDown id={domId("tree-chevron", node.path)} className="size-3.5" />
            ) : (
              <ChevronRight id={domId("tree-chevron", node.path)} className="size-3.5" />
            )}
          </button>
        ) : depth > 0 ? (
          <span id={domId("tree-spacer", node.path)} className="size-4 shrink-0" />
        ) : null}
        <span
          id={domId("tree-name", node.path)}
          className={cn("shrink-0", !tintFont && "text-zinc-100", depth === 0 && canToggle && "cursor-pointer")}
          style={tintFont ? { color: "var(--tree-folder)" } : undefined}
          title={node.path}
          onClick={depth === 0 ? onRootLabelClick : undefined}
        >
          {node.name}
        </span>
        {showRootPath || status || trailing || folderDirty ? (
          <span id={domId("tree-aside", node.path)} className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
            {showRootPath ? (
              <span
                id={domId("tree-root-path", node.path)}
                className={cn("min-w-0 truncate text-right text-xs text-zinc-500", canToggle && "cursor-pointer")}
                title={rootPath ?? ""}
                onClick={onRootLabelClick}
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
            ) : folderDirty ? (
              <span
                id={domId("tree-dirty", node.path)}
                className="size-2 shrink-0 rounded-full bg-amber-400"
                title="Uncommitted changes"
              />
            ) : null}
            {trailing ? (
              <span id={domId("tree-trailing", node.path)} className="shrink-0">
                {trailing}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {expanded && hasChildren ? (
        <div id={domId("tree-children", node.path)} className="relative">
          {showGuide ? (
            <span
              id={domId("tree-guide", node.path)}
              aria-hidden="true"
              className={cn("pointer-events-none absolute top-0 bottom-0 z-10 w-px", folderVar ? "opacity-80" : "bg-zinc-600")}
              style={{
                left: guideLeft(depth),
                ...(folderVar ? { backgroundColor: "var(--tree-folder)" } : {}),
              }}
            />
          ) : null}
          {node.children.map((child) => (
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
              onViewRepo={onViewRepo}
              onContextMenu={onContextMenu}
              folderVars={folderVars}
              folderColorMode={folderColorMode}
              folderIndicator={folderIndicator}
              dirtyFolders={dirtyFolders}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
