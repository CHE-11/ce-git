export function parentDirectories(relativePath: string) {
  const parts = relativePath.replaceAll("\\", "/").split("/").filter((part) => part.length > 0);
  parts.pop();
  const directories: string[] = [];
  while (parts.length > 0) {
    directories.push(parts.join("/"));
    parts.pop();
  }
  return directories;
}

export function fileExtension(relativePath: string) {
  const name = relativePath.replaceAll("\\", "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot);
}

export function absolutePath(repoPath: string, relativePath: string) {
  const separator = repoPath.includes("\\") ? "\\" : "/";
  const base = repoPath.replace(/[\\/]+$/u, "");
  const tail = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return [base, ...tail].join(separator);
}

export function fileManagerLabel() {
  const agent = navigator.userAgent;
  if (agent.includes("Windows")) {
    return "Show in Explorer";
  }
  if (agent.includes("Mac OS")) {
    return "Reveal in Finder";
  }
  return "Show in File Manager";
}
