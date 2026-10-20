import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

export type CommandGroup = "Workspace" | "Git" | "Settings" | "Active repo" | "AI";

export type CommandItem = {
  id: string;
  label: string;
  group: CommandGroup;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  commands: CommandItem[];
  onOpenChange: (open: boolean) => void;
};

const GROUP_ORDER: CommandGroup[] = ["Workspace", "Git", "Settings", "Active repo", "AI"];

function matches(command: CommandItem, query: string) {
  const haystack = `${command.label} ${command.keywords ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

export function CommandPalette({ open, commands, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commands;
    }
    return commands.filter((command) => matches(command, needle));
  }, [commands, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const next = filtered.findIndex((command) => !command.disabled);
    setActiveIndex(next === -1 ? 0 : next);
  }, [open, query]);

  useEffect(() => {
    setActiveIndex((index) => (filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => (filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const command = filtered[activeIndex];
        if (!command || command.disabled) {
          return;
        }
        onOpenChange(false);
        command.run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filtered, activeIndex, onOpenChange]);

  if (!open) {
    return null;
  }

  const run = (command: CommandItem) => {
    if (command.disabled) {
      return;
    }
    onOpenChange(false);
    command.run();
  };

  let flatIndex = 0;

  return (
    <div
      id="command-palette-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-6 pt-[12vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        id="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-label"
        className="flex max-h-[min(28rem,70vh)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="command-palette-header" className="border-b border-zinc-800 px-3 py-2">
          <label id="command-palette-label" htmlFor="command-palette-input" className="sr-only">
            Commands
          </label>
          <input
            id="command-palette-input"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={filtered[activeIndex] ? `command-palette-item-${filtered[activeIndex].id}` : undefined}
            className="h-9 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>
        <div id="command-palette-list" role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-auto p-1">
          {filtered.length === 0 ? (
            <p id="command-palette-empty" className="px-3 py-6 text-center text-sm text-zinc-500">
              No matching commands
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = filtered.filter((command) => command.group === group);
              if (items.length === 0) {
                return null;
              }
              const groupId = group.toLowerCase().replaceAll(" ", "-");
              return (
                <div id={`command-palette-group-${groupId}`} key={group} className="mb-1">
                  <p id={`command-palette-group-${groupId}-label`} className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                    {group}
                  </p>
                  {items.map((command) => {
                    const index = flatIndex;
                    flatIndex += 1;
                    const active = index === activeIndex;
                    return (
                      <button
                        id={`command-palette-item-${command.id}`}
                        key={command.id}
                        ref={(node) => {
                          itemRefs.current[index] = node;
                        }}
                        type="button"
                        role="option"
                        aria-selected={active}
                        aria-disabled={command.disabled || undefined}
                        disabled={command.disabled}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => run(command)}
                        className={cn(
                          "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-zinc-100",
                          active && "bg-zinc-800",
                          command.disabled && "cursor-not-allowed text-zinc-500",
                        )}
                      >
                        <span id={`command-palette-item-${command.id}-label`}>{command.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
