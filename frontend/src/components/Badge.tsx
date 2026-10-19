import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type BadgeProps = {
  id: string;
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red" | "violet";
};

const tones = {
  neutral: "bg-zinc-800 text-zinc-300",
  green: "bg-emerald-950 text-emerald-300",
  blue: "bg-sky-950 text-sky-300",
  amber: "bg-amber-950 text-amber-300",
  red: "bg-red-950 text-red-300",
  violet: "bg-violet-950 text-violet-300",
};

export function Badge({ id, children, tone = "neutral" }: BadgeProps) {
  return (
    <span id={id} className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
