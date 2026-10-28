export type StatusMark = {
  letter: string;
  label: string;
  className: string;
};

const STATUS_MARK: Record<string, StatusMark> = {
  added: { letter: "A", label: "Added", className: "text-emerald-400" },
  modified: { letter: "M", label: "Modified", className: "text-amber-300" },
  deleted: { letter: "D", label: "Deleted", className: "text-rose-400" },
  untracked: { letter: "U", label: "Untracked", className: "text-lime-400" },
  renamed: { letter: "R", label: "Renamed", className: "text-sky-400" },
  copied: { letter: "C", label: "Copied", className: "text-cyan-400" },
  unmerged: { letter: "!", label: "Unmerged", className: "text-violet-400" },
  typechange: { letter: "T", label: "Type change", className: "text-fuchsia-400" },
};

export function statusMark(status: string): StatusMark {
  return (
    STATUS_MARK[status] ?? {
      letter: status.slice(0, 1).toUpperCase() || "?",
      label: status.charAt(0).toUpperCase() + status.slice(1),
      className: "text-zinc-400",
    }
  );
}
