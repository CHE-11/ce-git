import type { TreeNode } from "../../../types/git";

export const TREE_STYLE_KEY = "ce-git.tree-style";
export const FOLDER_COLOR_COUNT = 12;

export type TreeStyle = {
  folderColorBackground: boolean;
  folderColorBackgroundUnique: boolean;
  folderFontColor: boolean;
  folderFontColorUnique: boolean;
  folderIndicator: boolean;
};

const OFF: TreeStyle = {
  folderColorBackground: false,
  folderColorBackgroundUnique: false,
  folderFontColor: false,
  folderFontColorUnique: false,
  folderIndicator: false,
};

export function treeStyleFrom(input: Partial<TreeStyle> | null | undefined): TreeStyle {
  const background = input?.folderColorBackground === true;
  return {
    folderColorBackground: background,
    folderColorBackgroundUnique: input?.folderColorBackgroundUnique === true,
    folderFontColor: input?.folderFontColor === true && !background,
    folderFontColorUnique: input?.folderFontColorUnique === true,
    folderIndicator: input?.folderIndicator === true,
  };
}

export function readTreeStyle(): TreeStyle {
  try {
    const raw = localStorage.getItem(TREE_STYLE_KEY);
    if (!raw) {
      return { ...OFF };
    }
    return treeStyleFrom(JSON.parse(raw) as Partial<TreeStyle>);
  } catch {
    return { ...OFF };
  }
}

export function publishTreeStyle(style: Partial<TreeStyle> | null | undefined) {
  const next = treeStyleFrom(style);
  try {
    localStorage.setItem(TREE_STYLE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota and private-mode failures; the choice still applies for this session.
  }
  return next;
}

export function folderColorMode(style: TreeStyle): "background" | "font" | null {
  if (style.folderColorBackground) {
    return "background";
  }
  if (style.folderFontColor) {
    return "font";
  }
  return null;
}

/** CSS variable for each tinted row. Shared mode uses the theme accent. Unique mode cycles the folder palette. */
export function folderColorVars(trees: readonly TreeNode[], unique: boolean) {
  const vars = new Map<string, string>();
  let next = 0;
  for (const root of trees) {
    for (const child of root.children) {
      if (child.kind !== "folder") {
        continue;
      }
      const variable = unique ? `--tree-folder-${next % FOLDER_COLOR_COUNT}` : "--app-sky-400";
      if (unique) {
        next += 1;
      }
      stampFolderColor(child, variable, vars);
    }
  }
  return vars;
}

function stampFolderColor(node: TreeNode, variable: string, vars: Map<string, string>) {
  vars.set(node.path, variable);
  for (const child of node.children) {
    stampFolderColor(child, variable, vars);
  }
}
