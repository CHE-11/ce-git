export type DiffSpan = {
  text: string;
  changed: boolean;
};

export type DiffRow = {
  remote: string | null;
  remoteLine: number | null;
  stash: string | null;
  stashLine: number | null;
  kind: "same" | "removed" | "added" | "changed";
  remoteSpans: DiffSpan[] | null;
  stashSpans: DiffSpan[] | null;
};

type Op = {
  type: "equal" | "insert" | "delete";
  value: string;
  aIndex?: number;
  bIndex?: number;
};

function splitLines(text: string) {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function myersDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return b.map((value, bIndex) => ({ type: "insert" as const, value, bIndex }));
  }
  if (m === 0) {
    return a.map((value, aIndex) => ({ type: "delete" as const, value, aIndex }));
  }

  const max = n + m;
  const offset = max;
  const v = new Array<number>(2 * max + 1).fill(0);
  const trace: number[][] = [];
  v[offset + 1] = 0;

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const index = offset + k;
      let x: number;
      if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
        x = v[index + 1];
      } else {
        x = v[index - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[index] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b, d, offset);
      }
    }
  }
  return [];
}

function backtrack(trace: number[][], a: string[], b: string[], dEnd: number, offset: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const index = offset + k;
    const prevK = k === -d || (k !== d && v[index - 1] < v[index + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ type: "equal", value: a[x] ?? "", aIndex: x, bIndex: y });
    }
    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        ops.push({ type: "insert", value: b[y] ?? "", bIndex: y });
      } else {
        x -= 1;
        ops.push({ type: "delete", value: a[x] ?? "", aIndex: x });
      }
    }
  }
  return ops.reverse();
}

function tokens(line: string) {
  return line.split(/(\s+)/).filter((part) => part.length > 0);
}

function spansFor(parts: string[], changed: Set<number>): DiffSpan[] {
  const spans: DiffSpan[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const text = parts[index] ?? "";
    const mark = changed.has(index);
    const previous = spans.at(-1);
    if (previous && previous.changed === mark) {
      previous.text += text;
    } else {
      spans.push({ text, changed: mark });
    }
  }
  return spans;
}

function intraLine(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length > 400 || b.length > 400) {
    return {
      remoteSpans: [{ text: left, changed: true }],
      stashSpans: [{ text: right, changed: true }],
    };
  }
  const ops = myersDiff(a, b);
  const leftChanged = new Set<number>();
  const rightChanged = new Set<number>();
  for (const op of ops) {
    if (op.type === "delete" && op.aIndex !== undefined) {
      leftChanged.add(op.aIndex);
    }
    if (op.type === "insert" && op.bIndex !== undefined) {
      rightChanged.add(op.bIndex);
    }
  }
  return {
    remoteSpans: spansFor(a, leftChanged),
    stashSpans: spansFor(b, rightChanged),
  };
}

function align(ops: Op[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (!op) {
      break;
    }
    if (op.type === "equal") {
      rows.push({
        kind: "same",
        remote: op.value,
        remoteLine: (op.aIndex ?? 0) + 1,
        stash: op.value,
        stashLine: (op.bIndex ?? 0) + 1,
        remoteSpans: null,
        stashSpans: null,
      });
      index += 1;
      continue;
    }
    const removed: Op[] = [];
    const added: Op[] = [];
    while (index < ops.length && ops[index]?.type === "delete") {
      const next = ops[index];
      if (next) {
        removed.push(next);
      }
      index += 1;
    }
    while (index < ops.length && ops[index]?.type === "insert") {
      const next = ops[index];
      if (next) {
        added.push(next);
      }
      index += 1;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      const left = removed[pair];
      const right = added[pair];
      if (!left || !right) {
        continue;
      }
      const spans = intraLine(left.value, right.value);
      rows.push({
        kind: "changed",
        remote: left.value,
        remoteLine: (left.aIndex ?? 0) + 1,
        stash: right.value,
        stashLine: (right.bIndex ?? 0) + 1,
        remoteSpans: spans.remoteSpans,
        stashSpans: spans.stashSpans,
      });
    }
    for (let pair = pairs; pair < removed.length; pair += 1) {
      const left = removed[pair];
      if (!left) {
        continue;
      }
      rows.push({
        kind: "removed",
        remote: left.value,
        remoteLine: (left.aIndex ?? 0) + 1,
        stash: null,
        stashLine: null,
        remoteSpans: null,
        stashSpans: null,
      });
    }
    for (let pair = pairs; pair < added.length; pair += 1) {
      const right = added[pair];
      if (!right) {
        continue;
      }
      rows.push({
        kind: "added",
        remote: null,
        remoteLine: null,
        stash: right.value,
        stashLine: (right.bIndex ?? 0) + 1,
        remoteSpans: null,
        stashSpans: null,
      });
    }
  }
  return rows;
}

export function diffLines(remote: string, stash: string): DiffRow[] {
  return align(myersDiff(splitLines(remote), splitLines(stash)));
}
