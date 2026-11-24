export type SplitSide = {
  line: number | null;
  text: string;
};

export type SplitRow =
  | { kind: "meta"; text: string }
  | { kind: "hunk"; text: string }
  | {
      kind: "context" | "removed" | "added" | "changed";
      left: SplitSide | null;
      right: SplitSide | null;
    };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function splitRows(patch: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let untracked = false;
  let removed: SplitSide[] = [];
  let added: SplitSide[] = [];

  function flush() {
    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) {
      rows.push({ kind: "changed", left: removed[index], right: added[index] });
    }
    for (const side of removed.slice(paired)) {
      rows.push({ kind: "removed", left: side, right: null });
    }
    for (const side of added.slice(paired)) {
      rows.push({ kind: "added", left: null, right: side });
    }
    removed = [];
    added = [];
  }

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("# untracked ")) {
      flush();
      inHunk = false;
      untracked = line.startsWith("# untracked ");
      newLine = 0;
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (untracked) {
      newLine += 1;
      rows.push({ kind: "added", left: null, right: { line: newLine, text: line } });
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      flush();
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk) {
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("-")) {
      if (added.length > 0) {
        flush();
      }
      removed.push({ line: oldLine, text: line.slice(1) });
      oldLine += 1;
      continue;
    }
    if (line.startsWith("+")) {
      added.push({ line: newLine, text: line.slice(1) });
      newLine += 1;
      continue;
    }
    flush();
    if (line.startsWith("\\") || line === "") {
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith(" ")) {
      const text = line.slice(1);
      rows.push({
        kind: "context",
        left: { line: oldLine, text },
        right: { line: newLine, text },
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    inHunk = false;
    rows.push({ kind: "meta", text: line });
  }
  flush();

  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    const blank = (last.kind === "meta" && last.text === "") || (last.kind === "added" && last.right?.text === "");
    if (!blank) {
      break;
    }
    rows.pop();
  }
  return rows;
}
