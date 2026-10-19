export type FilePatch = {
  path: string;
  text: string;
  truncated: boolean;
};

const TRUNCATION_MARK = "[diff truncated]";

export function patchForPath(patch: string, path: string | null): FilePatch {
  if (!path) {
    return { path: "", text: "", truncated: false };
  }
  const wanted = normalizePath(path);
  const matches = splitPatch(patch).filter((section) => normalizePath(section.path) === wanted);
  const text = matches
    .map((section) => section.text)
    .join("\n\n")
    .trim();
  return {
    path,
    text,
    truncated: text.includes(TRUNCATION_MARK),
  };
}

function splitPatch(patch: string): FilePatch[] {
  const sections: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } | null = null;

  for (const line of patch.split("\n")) {
    const path = sectionPath(line);
    if (path) {
      if (current) sections.push(current);
      current = { path, lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections.map((section) => {
    const text = section.lines.join("\n").trim();
    return {
      path: section.path,
      text,
      truncated: text.includes(TRUNCATION_MARK),
    };
  });
}

function sectionPath(line: string) {
  return gitDiffPath(line) ?? untrackedPath(line);
}

function gitDiffPath(line: string) {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length);
  if (rest.startsWith('"')) {
    const match = /^"(?:\\.|[^"])*"\s+"((?:\\.|[^"])*)"$/.exec(rest);
    if (!match) return null;
    const quoted = unescapeGit(match[1]);
    return quoted.startsWith("b/") ? quoted.slice(2) : quoted;
  }
  const marker = " b/";
  const index = rest.lastIndexOf(marker);
  if (index < 0) return null;
  return rest.slice(index + marker.length);
}

function untrackedPath(line: string) {
  const prefix = "# untracked ";
  if (!line.startsWith(prefix)) return null;
  const path = line.slice(prefix.length).trim();
  return path || null;
}

function unescapeGit(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}
