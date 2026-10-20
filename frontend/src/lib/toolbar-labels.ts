export const TOOLBAR_LABELS_KEY = "ce-git.toolbar-labels";

export function readToolbarLabels() {
  try {
    return localStorage.getItem(TOOLBAR_LABELS_KEY) === "1";
  } catch {
    return false;
  }
}

export function publishToolbarLabels(enabled: boolean) {
  try {
    localStorage.setItem(TOOLBAR_LABELS_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore quota and private-mode failures; the choice still applies for this session.
  }
  return enabled;
}
