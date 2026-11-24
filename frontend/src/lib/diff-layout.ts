export type DiffLayout = "unified" | "split";

export const DIFF_LAYOUT_KEY = "ce-git.diff-layout";

export function readDiffLayout(): DiffLayout {
  try {
    return localStorage.getItem(DIFF_LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function storeDiffLayout(layout: DiffLayout) {
  try {
    localStorage.setItem(DIFF_LAYOUT_KEY, layout);
  } catch {
    // Ignore quota and private-mode failures; the choice still applies for this session.
  }
  return layout;
}
