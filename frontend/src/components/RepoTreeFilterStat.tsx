import { cn } from "../lib/cn";

type RepoTreeFilterStatProps = {
  id: string;
  label: string;
  value: string;
  valueClassName?: string;
  pressed?: boolean;
  title: string;
  onClick: () => void;
};

export function RepoTreeFilterStat({
  id,
  label,
  value,
  valueClassName,
  pressed,
  title,
  onClick,
}: RepoTreeFilterStatProps) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[11px] leading-none hover:bg-zinc-800",
        pressed && "bg-zinc-800",
      )}
    >
      <span id={`${id}-label`} className="text-zinc-500">
        {label}
      </span>
      <span id={`${id}-value`} className={cn("text-zinc-200", valueClassName)}>
        {value}
      </span>
    </button>
  );
}
