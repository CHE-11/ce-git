import { useState } from "react";
import type { PublishOptions, RepoVisibility } from "../../../../types/git";
import { messageOf } from "../../lib/tree";
import { Button } from "../Button";
import { Dialog } from "./Dialog";

const fieldClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50";

const VISIBILITY: { value: RepoVisibility; label: string; hint: string }[] = [
  { value: "private", label: "Private", hint: "Only you and people you add" },
  { value: "public", label: "Public", hint: "Anyone on the internet" },
  { value: "internal", label: "Internal", hint: "Visible inside an organization" },
];

type PublishDialogProps = {
  open: boolean;
  repoName: string;
  onClose: () => void;
  onPublish: (options: PublishOptions) => Promise<void>;
};

function githubRepoName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._\-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[-._]{2,}/g, (match) => match[0] ?? "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100);
  return cleaned || "repository";
}

function validate(name: string, description: string, homepage: string) {
  const repoName = name.trim();
  const part = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
  if (repoName.length === 0 || repoName.length > 100 || !new RegExp(`^${part}(?:/${part})?$`).test(repoName)) {
    return "Repository name can only contain letters, numbers, dots, hyphens, and underscores. Use owner/name for an organization.";
  }
  if ([...description.trim()].length > 350) {
    return "Description must be 350 characters or fewer.";
  }
  const page = homepage.trim();
  if (page && !/^https?:\/\/\S+$/.test(page)) {
    return "Homepage must be an http or https URL.";
  }
  return null;
}

export function PublishDialog({ open, repoName, onClose, onPublish }: PublishDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [homepage, setHomepage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [sessionRepo, setSessionRepo] = useState<string | null>(null);

  if (open && sessionRepo !== repoName) {
    setSessionRepo(repoName);
    setName(githubRepoName(repoName));
    setDescription("");
    setVisibility("private");
    setHomepage("");
    setError(null);
    setPublishing(false);
  }
  if (!open && sessionRepo !== null) {
    setSessionRepo(null);
  }

  const requestClose = () => {
    if (publishing) {
      return;
    }
    onClose();
  };

  const publish = async () => {
    const problem = validate(name, description, homepage);
    if (problem) {
      setError(problem);
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await onPublish({
        name: name.trim(),
        description: description.trim(),
        visibility,
        homepage: homepage.trim(),
      });
    } catch (caught) {
      setError(messageOf(caught));
      setPublishing(false);
    }
  };

  return (
    <Dialog
      id="publish-dialog"
      title={publishing ? "Publishing repository" : "Publish repository"}
      open={open}
      onClose={requestClose}
    >
      <form
        id="publish-form"
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        <p id="publish-copy" className="text-sm text-zinc-300">
          Create this repository on GitHub, set <span id="publish-origin-word">origin</span>, and push the current branch.
          Uncommitted changes stay on disk.
        </p>
        <label
          id="publish-name-label"
          htmlFor="publish-name-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Repository name
        </label>
        <input
          id="publish-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={publishing}
          placeholder="owner/name"
          className={fieldClass}
        />
        <p id="publish-name-hint" className="mt-1 text-xs text-zinc-500">
          Leave off the owner to publish under your account, or enter owner/name for an organization.
        </p>
        <label
          id="publish-description-label"
          htmlFor="publish-description-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Description
        </label>
        <textarea
          id="publish-description-input"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setError(null);
          }}
          rows={3}
          disabled={publishing}
          placeholder="Optional"
          className={fieldClass}
        />
        <fieldset id="publish-visibility" className="mt-4" disabled={publishing}>
          <legend id="publish-visibility-legend" className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Visibility
          </legend>
          <div id="publish-visibility-options" className="grid grid-cols-3 gap-2">
            {VISIBILITY.map((option) => {
              const selected = visibility === option.value;
              return (
                <label
                  id={`publish-visibility-${option.value}`}
                  key={option.value}
                  className={
                    selected
                      ? "cursor-pointer rounded-md border border-sky-500 bg-sky-950/40 px-2 py-2"
                      : "cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 hover:border-zinc-500"
                  }
                >
                  <input
                    id={`publish-visibility-${option.value}-input`}
                    type="radio"
                    name="publish-visibility"
                    value={option.value}
                    checked={selected}
                    onChange={() => {
                      setVisibility(option.value);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <span id={`publish-visibility-${option.value}-label`} className="block text-sm font-medium text-zinc-100">
                    {option.label}
                  </span>
                  <span id={`publish-visibility-${option.value}-hint`} className="mt-0.5 block text-xs text-zinc-500">
                    {option.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <label
          id="publish-homepage-label"
          htmlFor="publish-homepage-input"
          className="mt-4 mb-1 block text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Homepage
        </label>
        <input
          id="publish-homepage-input"
          value={homepage}
          onChange={(event) => {
            setHomepage(event.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={publishing}
          placeholder="https://example.com"
          className={fieldClass}
        />
        {error ? (
          <p id="publish-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div id="publish-actions" className="mt-4 flex justify-end gap-2">
          <Button id="publish-cancel" variant="ghost" onClick={requestClose} disabled={publishing}>
            <span id="publish-cancel-label">Cancel</span>
          </Button>
          <Button id="publish-submit" variant="primary" type="submit" disabled={publishing || name.trim().length === 0}>
            <span id="publish-submit-label">{publishing ? "Publishing…" : "Publish"}</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
