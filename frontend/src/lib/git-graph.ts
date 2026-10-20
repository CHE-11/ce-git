import type { GraphCommit } from "../../../types/git";

export const GRAPH_ROW_HEIGHT = 48;
export const GRAPH_COLUMN_WIDTH = 14;
export const GRAPH_GUTTER = 10;

export type GraphStroke = {
  fromColumn: number;
  toColumn: number;
  fromY: "top" | "mid";
  toY: "mid" | "bottom";
  color: number;
};

export type GraphRow = {
  commit: GraphCommit;
  column: number;
  color: number;
  strokes: GraphStroke[];
};

type Slot = {
  hash: string;
  color: number;
} | null;

export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  const slots: Slot[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  const takeColor = () => {
    const color = nextColor;
    nextColor += 1;
    return color;
  };

  const findHash = (hash: string) => slots.findIndex((slot) => slot?.hash === hash);

  for (const commit of commits) {
    const strokes: GraphStroke[] = [];
    let column = findHash(commit.hash);
    let color: number;

    if (column === -1) {
      column = slots.indexOf(null);
      color = takeColor();
      const slot = { hash: commit.hash, color };
      if (column === -1) {
        column = slots.length;
        slots.push(slot);
      } else {
        slots[column] = slot;
      }
    } else {
      color = slots[column]?.color ?? takeColor();
      strokes.push({ fromColumn: column, toColumn: column, fromY: "top", toY: "mid", color });
    }

    const passing = slots.flatMap((slot, index) => (slot && index !== column ? [{ slot, index }] : []));

    slots[column] = null;
    const parents = commit.parents.filter((parent) => parent.length > 0);
    if (parents.length > 0) {
      const first = parents[0];
      const existing = findHash(first);
      if (existing !== -1 && slots[existing]) {
        const target = slots[existing];
        strokes.push({
          fromColumn: column,
          toColumn: existing,
          fromY: "mid",
          toY: "bottom",
          color: target.color,
        });
      } else {
        slots[column] = { hash: first, color };
        strokes.push({ fromColumn: column, toColumn: column, fromY: "mid", toY: "bottom", color });
      }

      for (const parent of parents.slice(1)) {
        let parentColumn = findHash(parent);
        let parentColor: number;
        if (parentColumn === -1 || !slots[parentColumn]) {
          parentColumn = slots.findIndex((slot, index) => slot === null && index !== column);
          parentColor = takeColor();
          const slot = { hash: parent, color: parentColor };
          if (parentColumn === -1) {
            parentColumn = slots.length;
            slots.push(slot);
          } else {
            slots[parentColumn] = slot;
          }
        } else {
          parentColor = slots[parentColumn]?.color ?? takeColor();
        }
        strokes.push({
          fromColumn: column,
          toColumn: parentColumn,
          fromY: "mid",
          toY: "bottom",
          color: parentColor,
        });
      }
    }

    for (const item of passing) {
      if (slots[item.index]?.hash === item.slot.hash) {
        strokes.push({
          fromColumn: item.index,
          toColumn: item.index,
          fromY: "top",
          toY: "bottom",
          color: item.slot.color,
        });
      }
    }

    while (slots.length > 0 && slots[slots.length - 1] === null) {
      slots.pop();
    }

    rows.push({ commit, column, color, strokes });
  }

  return rows;
}

export function graphColumnCount(rows: readonly GraphRow[]) {
  let columns = 1;
  for (const row of rows) {
    columns = Math.max(columns, row.column + 1);
    for (const stroke of row.strokes) {
      columns = Math.max(columns, stroke.fromColumn + 1, stroke.toColumn + 1);
    }
  }
  return columns;
}
