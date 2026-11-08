import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RepoBranch } from "../../../../types/git";
import { listBranches } from "../../lib/git-client";
import { messageOf } from "../../lib/tree";
import { cn } from "../../lib/cn";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

type Pending = { kind: "checkout"; name: string } | { kind: "create" };

type BranchDialogProps = {
  repoPath: string;
  dirty: boolean;
  detached: boolean;
  busy: boolean;
  onClose: () => void;
  onCheckout: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
};

function branchDomId(branch: RepoBranch, index: number) {
  const slug = branch.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `branch-option-${branch.kind}-${slug || "unnamed"}-${index}`;
}

export function BranchDialog({ repoPath, dirty, detached, busy, onClose, onCheckout, onCreate }: BranchDialogProps) {
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const preferName = useRef(dirty);
  const shownError = actionError ?? loadError;
  const locked = busy || pending !== null;

  useEffect(() => {
    const node = preferName.current ? nameRef.current : filterRef.current;
    node?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listBranches(repoPath)
      .then((next) => {
        if (!cancelled) {
          setBranches(next);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setBranches([]);
          setLoadError(messageOf(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return branches;
    }
    return branches.filter((branch) => {
      const upstream = branch.upstream ?? "";
      return branch.name.toLowerCase().includes(needle) || upstream.toLowerCase().includes(needle);
    });
  }, [branches, query]);

  const requestClose = () => {
    if (pending) {
      return;
    }
    onClose();
  };

  const checkout = async (branch: RepoBranch) => {
    if (branch.current || locked) {
      return;
    }
    setActionError(null);
    setPending({ kind: "checkout", name: branch.name });
    try {
      await onCheckout(branch.name);
      onClose();
    } catch (caught) {
      setActionError(messageOf(caught));
      setPending(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || locked) {
      return;
    }
    setActionError(null);
    setPending({ kind: "create" });
    try {
      await onCreate(next);
      onClose();
    } catch (caught) {
      setActionError(messageOf(caught));
      setPending(null);
    }
  };

  return (
    <Dialog id="branch-dialog" title="Branches" open onClose={requestClose} panelClassName="max-w-md">
      <p id="branch-dialog-copy" className="text-sm text-zinc-300">
        Switch to another branch, or create a new one from where you are. Uncommitted changes come along when the other branch can take them.
      </p>
      {detached ? (
        <p id="branch-dialog-detached" className="mt-2 text-sm text-amber-300">
          HEAD is detached. A new branch keeps this commit and your changes.
        </p>
      ) : null}
      <label
        id="branch-filter-label"
        htmlFor="branch-filter"
        className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
      >
        Branches
      </label>
      <input
        id="branch-filter"
        ref={filterRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={locked}
        autoComplete="off"
        spellCheck={false}
        placeholder="Filter branches"
        className={cn(fieldClass, "w-full")}
      />
      {loading ? (
        <p id="branch-list-loading" className="mt-3 text-sm text-zinc-500">
          Loading branches…
        </p>
      ) : (
        <div id="branch-list" className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-800">
          {visible.length === 0 ? (
            <p id="branch-list-empty" className="px-2 py-3 text-sm text-zinc-500">
              {query.trim() ? "No branches match." : "No branches yet."}
            </p>
          ) : (
            <ul id="branch-list-items" className="p-1">
              {visible.map((branch, index) => {
                const id = branchDomId(branch, index);
                const meta = (
                  <>
                    <span id={`${id}-name`} className="min-w-0 flex-1 truncate">
                      {branch.name}
                    </span>
                    {branch.kind === "remote" ? (
                      <span id={`${id}-kind`} className="shrink-0 text-[10px] font-medium tracking-wide text-zinc-500 uppercase">
                        Remote
                      </span>
                    ) : null}
                    {branch.upstream ? (
                      <span id={`${id}-upstream`} className="max-w-40 shrink-0 truncate text-xs text-zinc-500" title={branch.upstream}>
                        {branch.upstream}
                      </span>
                    ) : null}
                    {branch.current ? (
                      <span id={`${id}-current`} className="shrink-0 text-xs text-sky-300">
                        Current
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li id={`${id}-item`} key={`${branch.kind}:${branch.name}`} className="list-none">
                    {branch.current ? (
                      <div id={id} aria-current="true" title="Current branch" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-sky-100">
                        {meta}
                      </div>
                    ) : (
                      <button
                        id={id}
                        type="button"
                        disabled={locked}
                        title={
                          branch.kind === "remote"
                            ? "Check out this remote branch. Uncommitted changes come along when they fit."
                            : "Switch to this branch. Uncommitted changes come along when they fit."
                        }
                        onClick={() => void checkout(branch)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {meta}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {pending ? (
        <p id="branch-dialog-pending" className="mt-3 text-xs text-zinc-400">
          {pending.kind === "create" ? "Creating branch…" : `Switching to ${pending.name}…`}
        </p>
      ) : null}
      {shownError ? (
        <p id="branch-dialog-error" className="mt-3 text-sm text-red-400">
          {shownError}
        </p>
      ) : null}
      <form id="branch-create-form" className="mt-4 border-t border-zinc-800 pt-3" onSubmit={(event) => void create(event)}>
        <label
          id="branch-create-label"
          htmlFor="branch-create-name"
          className="mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          New branch
        </label>
        <p id="branch-create-hint" className="mb-2 text-xs text-zinc-500">
          {dirty ? "Starts at this commit and keeps the uncommitted changes." : "Starts at this commit."}
        </p>
        <div id="branch-create-row" className="flex gap-2">
          <input
            id="branch-create-name"
            ref={nameRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setActionError(null);
            }}
            disabled={locked}
            autoComplete="off"
            spellCheck={false}
            placeholder="Branch name"
            className={fieldClass}
          />
          <Button id="branch-create-submit" variant="primary" type="submit" disabled={locked || name.trim().length === 0}>
            <span id="branch-create-submit-label">{pending?.kind === "create" ? "Creating…" : "Create"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
