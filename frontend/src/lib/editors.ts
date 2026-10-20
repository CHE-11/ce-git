export const DEFAULT_EDITOR_KEY = "ce-git.default-editor";
export const MENU_EDITORS_KEY = "ce-git.menu-editors";

export const EDITORS = [
  { id: "default", label: "Default editor", group: "Editors" },
  { id: "code", label: "VS Code", group: "Editors" },
  { id: "code-insiders", label: "VS Code Insiders", group: "Editors" },
  { id: "cursor", label: "Cursor", group: "Editors" },
  { id: "windsurf", label: "Windsurf", group: "Editors" },
  { id: "zed", label: "Zed", group: "Editors" },
  { id: "sublime", label: "Sublime Text", group: "Editors" },
  { id: "idea", label: "IntelliJ IDEA", group: "JetBrains" },
  { id: "webstorm", label: "WebStorm", group: "JetBrains" },
  { id: "pycharm", label: "PyCharm", group: "JetBrains" },
  { id: "goland", label: "GoLand", group: "JetBrains" },
  { id: "rustrover", label: "RustRover", group: "JetBrains" },
  { id: "rider", label: "Rider", group: "JetBrains" },
  { id: "clion", label: "CLion", group: "JetBrains" },
  { id: "phpstorm", label: "PhpStorm", group: "JetBrains" },
  { id: "rubymine", label: "RubyMine", group: "JetBrains" },
] as const;

export type EditorChoice = (typeof EDITORS)[number];
export type EditorId = EditorChoice["id"];

export const DEFAULT_EDITOR_ID: EditorId = "default";
export const DEFAULT_MENU_EDITORS: EditorId[] = ["default", "code", "cursor"];

const EDITOR_GROUPS = [
  { id: "editors", label: "Editors" },
  { id: "jetbrains", label: "JetBrains" },
] as const;

export function isEditorId(value: string): value is EditorId {
  return EDITORS.some((editor) => editor.id === value);
}

export function normalizeEditor(value: string | null | undefined): EditorId {
  const id = value?.trim() ?? "";
  return isEditorId(id) ? id : DEFAULT_EDITOR_ID;
}

export function normalizeMenuEditors(values: readonly string[] | null | undefined): EditorId[] {
  const chosen = new Set((values ?? []).map((value) => value.trim()).filter(isEditorId));
  return EDITORS.filter((editor) => chosen.has(editor.id)).map((editor) => editor.id);
}

export function editorById(id: string): EditorChoice {
  return EDITORS.find((editor) => editor.id === id) ?? EDITORS[0];
}

export function editorGroups() {
  return EDITOR_GROUPS.map((group) => ({
    ...group,
    editors: EDITORS.filter((editor) => editor.group === group.label),
  }));
}

export function editorsForMenu(selected: readonly string[] | null | undefined) {
  const enabled = new Set(normalizeMenuEditors(selected));
  return EDITORS.filter((editor) => enabled.has(editor.id));
}

export function openInLabel(editor: Pick<EditorChoice, "id" | "label">) {
  return editor.id === "default" ? "Open in default editor" : `Open in ${editor.label}`;
}

export function gitignoreLabel(editor: Pick<EditorChoice, "id" | "label">) {
  return editor.id === "default" ? "Open .gitignore in default editor" : `Open .gitignore in ${editor.label}`;
}

export function editorTargetTitle(editor: Pick<EditorChoice, "id" | "label">, target: "folder" | "file") {
  const name = editor.id === "default" ? "the default editor" : editor.label;
  return target === "folder" ? `Open this folder in ${name}` : `Open this file in ${name}`;
}

export function fileOpenMode(editor: EditorId): "editor" | Exclude<EditorId, "default"> {
  if (editor === "default") {
    return "editor";
  }
  return editor;
}

export function readDefaultEditor(): EditorId {
  try {
    return normalizeEditor(localStorage.getItem(DEFAULT_EDITOR_KEY));
  } catch {
    return DEFAULT_EDITOR_ID;
  }
}

export function publishDefaultEditor(value: string | null | undefined) {
  const next = normalizeEditor(value);
  try {
    localStorage.setItem(DEFAULT_EDITOR_KEY, next);
  } catch {
    // Ignore quota and private-mode failures; the choice still applies for this session.
  }
  return next;
}

export function readMenuEditors(): EditorId[] {
  try {
    const raw = localStorage.getItem(MENU_EDITORS_KEY);
    if (raw === null) {
      return [...DEFAULT_MENU_EDITORS];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_MENU_EDITORS];
    }
    return normalizeMenuEditors(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [...DEFAULT_MENU_EDITORS];
  }
}

export function publishMenuEditors(value: readonly string[] | null | undefined) {
  const next = value == null ? [...DEFAULT_MENU_EDITORS] : normalizeMenuEditors(value);
  try {
    localStorage.setItem(MENU_EDITORS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota and private-mode failures; the choice still applies for this session.
  }
  return next;
}
