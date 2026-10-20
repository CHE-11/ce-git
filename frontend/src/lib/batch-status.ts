import type { BatchProgress } from "../../../types/git";

export function batchStatusLabel(entry: BatchProgress) {
  if (entry.action === "pull" && entry.status === "ok") {
    return "updated";
  }
  return entry.status;
}
