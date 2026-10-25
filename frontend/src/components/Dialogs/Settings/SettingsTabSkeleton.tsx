import type { ReactNode } from "react";
import { COLOR_MODE_OPTIONS, THEMES } from "../../../lib/appearance";
import { cn } from "../../../lib/cn";
import { editorGroups } from "../../../lib/editors";

type SettingsTabId = "app" | "git" | "ai" | "ignore";

const PROMPT_SLOTS = 3;

export function SettingsTabSkeleton({ tab }: { tab: SettingsTabId }) {
  if (tab === "git") {
    return <GitSkeleton />;
  }
  if (tab === "ai") {
    return <AiSkeleton />;
  }
  if (tab === "ignore") {
    return <IgnoreSkeleton />;
  }
  return <AppSkeleton />;
}

function AppSkeleton() {
  const groups = editorGroups();

  return (
    <SkeletonPanel id="settings-panel-app" labelledBy="settings-tab-app" className="mt-4 flex flex-col gap-3">
      <TextSkeleton
        id="settings-skeleton-app-intro"
        text="Save stores appearance, editors, and the settings folder. A folder keeps them in ce-git.json, including on a shared drive. The OpenAI key stays in this computer's credential manager, and Git settings stay in Git."
        textClassName="text-sm leading-5"
      />

      <section id="settings-skeleton-app-application" className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <Bone id="settings-skeleton-app-exe-label" className="h-3 w-24 shrink-0" />
        <Bone id="settings-skeleton-app-exe" className="h-3 min-w-0 flex-1" />
        <Bone id="settings-skeleton-app-exe-reveal" className="h-7 w-28 shrink-0" />
      </section>

      <SkeletonSection
        id="settings-skeleton-app-location"
        title="Settings folder"
        hint="Leave this blank to keep a copy on this computer. Clear the folder to stop using a shared file without deleting it."
      >
        <LineBone id="settings-skeleton-app-folder-label" text="Folder" className="mb-1" textClassName="text-xs" width="w-12" />
        <div id="settings-skeleton-app-folder-row" className="flex items-center gap-2">
          <ControlSkeleton id="settings-skeleton-app-folder-input" className="min-w-0 flex-1" />
          <Bone id="settings-skeleton-app-browse" className="h-8 w-16 shrink-0" />
          <Bone id="settings-skeleton-app-clear" className="h-8 w-14 shrink-0" />
        </div>
        <LineBone
          id="settings-skeleton-app-folder-file"
          text="Settings file: on this computer"
          className="mt-2"
          textClassName="truncate font-mono text-xs"
          width="w-2/3"
        />
      </SkeletonSection>

      <SkeletonSection
        id="settings-skeleton-app-editors"
        title="Editors"
        hint="Choose the default used by Open in editor. Turn on Menu to list that editor in the repository and changes right-click menus."
      >
        <div id="settings-skeleton-app-editor-groups" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <div id={`settings-skeleton-app-editor-group-${group.id}`} key={group.id} className="min-w-0">
              <LineBone
                id={`settings-skeleton-app-editor-group-${group.id}-label`}
                text={group.label}
                className="mb-1.5"
                textClassName="text-xs"
                width="w-20"
              />
              <div id={`settings-skeleton-app-editor-group-${group.id}-list`} className="flex flex-col gap-1">
                {group.editors.map((editor) => (
                  <div
                    id={`settings-skeleton-app-editor-${editor.id}`}
                    key={editor.id}
                    className="flex items-center gap-2 rounded-md border border-zinc-800 px-2 py-1"
                  >
                    <Bone id={`settings-skeleton-app-editor-${editor.id}-radio`} className="size-3.5 shrink-0 rounded-full" />
                    <Bone id={`settings-skeleton-app-editor-${editor.id}-name`} className="h-5 min-w-0 flex-1" />
                    <Bone id={`settings-skeleton-app-editor-${editor.id}-menu`} className="h-4 w-12 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SkeletonSection>

      <SkeletonSection
        id="settings-skeleton-app-appearance"
        title="Appearance"
        hint="Text size, color mode, and toolbar labels apply as you change them. Save keeps the choice."
      >
        <LineBone id="settings-skeleton-app-zoom-label" text="Text size" className="mb-1" textClassName="text-xs" width="w-16" />
        <div id="settings-skeleton-app-zoom-row" className="flex items-center gap-3">
          <div id="settings-skeleton-app-zoom" className="relative min-w-0 flex-1">
            <input id="settings-skeleton-app-zoom-spacer" type="range" tabIndex={-1} aria-hidden="true" className="invisible w-full" />
            <Bone id="settings-skeleton-app-zoom-track" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
          </div>
          <LineBone
            id="settings-skeleton-app-zoom-value"
            text="100%"
            className="w-12 shrink-0"
            textClassName="text-right text-sm tabular-nums"
            width="w-full"
          />
        </div>
        <TextSkeleton
          id="settings-skeleton-app-zoom-hint"
          text="Ctrl plus and Ctrl minus change this while you work. The status bar shows the current size."
          className="mt-1"
          textClassName="text-xs"
        />

        <div id="settings-skeleton-app-mode-block" className="mt-4">
          <LineBone id="settings-skeleton-app-mode-label" text="Color mode" className="mb-1" textClassName="text-xs" width="w-20" />
          <div id="settings-skeleton-app-modes" className="flex overflow-hidden rounded-md border border-zinc-700">
            {COLOR_MODE_OPTIONS.map((option) => (
              <Bone id={`settings-skeleton-app-mode-${option.id}`} key={option.id} className="h-8 flex-1 rounded-none" />
            ))}
          </div>
          <TextSkeleton
            id="settings-skeleton-app-mode-hint"
            text="Match system follows this computer's light or dark setting."
            className="mt-1"
            textClassName="text-xs"
          />
        </div>

        <div id="settings-skeleton-app-toolbar" className="mt-4 flex items-center gap-2">
          <Bone id="settings-skeleton-app-toolbar-box" className="size-4 shrink-0 rounded-sm" />
          <LineBone
            id="settings-skeleton-app-toolbar-label"
            text="Show names under toolbar buttons"
            textClassName="text-sm"
            width="w-64"
          />
        </div>

        <div id="settings-skeleton-app-theme-block" className="mt-4">
          <LineBone id="settings-skeleton-app-theme-label" text="Theme" className="mb-1" textClassName="text-xs" width="w-12" />
          <div id="settings-skeleton-app-themes" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEMES.map((theme) => (
              <div
                id={`settings-skeleton-app-theme-${theme.id}`}
                key={theme.id}
                className="flex items-center gap-2.5 rounded-md border border-zinc-700 px-2.5 py-1.5"
              >
                <Bone id={`settings-skeleton-app-theme-${theme.id}-swatch`} className="h-7 w-10 shrink-0" />
                <Bone id={`settings-skeleton-app-theme-${theme.id}-label`} className="h-4 w-16" />
              </div>
            ))}
          </div>
          <TextSkeleton
            id="settings-skeleton-app-theme-hint"
            text="Choose a settings folder and ce-git will add ce-git.css there, with the color overrides commented out."
            className="mt-2"
            textClassName="text-xs leading-5"
          />
        </div>
      </SkeletonSection>
    </SkeletonPanel>
  );
}

function GitSkeleton() {
  return (
    <SkeletonPanel id="settings-panel-git" labelledBy="settings-tab-git">
      <TextSkeleton
        id="settings-skeleton-git-intro"
        text="Sign in to GitHub for pull and push, and set the name and email Git writes on new commits."
        className="mt-4"
        textClassName="text-sm"
      />

      <section id="settings-skeleton-git-account" className="mt-4">
        <LineBone id="settings-skeleton-git-account-heading" text="Account" textClassName="text-xs" width="w-16" />
        <TextSkeleton
          id="settings-skeleton-git-account-status"
          text="Sign in to store a GitHub account and set Git Credential Manager as Git's credential helper."
          className="mt-2"
          textClassName="text-sm"
        />
        <LineBone id="settings-skeleton-git-username-label" text="GitHub username" className="mt-3 mb-1" textClassName="text-xs" width="w-32" />
        <ControlSkeleton id="settings-skeleton-git-username" />
        <TextSkeleton
          id="settings-skeleton-git-username-hint"
          text="Leave this blank to use the GitHub account already open in the browser."
          className="mt-1"
          textClassName="text-xs"
        />
        <Bone id="settings-skeleton-git-sign-in" className="mt-3 h-8 w-40" />
      </section>

      <section id="settings-skeleton-git-commits" className="mt-5">
        <LineBone id="settings-skeleton-git-commits-heading" text="Commits" textClassName="text-xs" width="w-16" />
        <LineBone id="settings-skeleton-git-name-label" text="Name" className="mt-3 mb-1" textClassName="text-xs" width="w-12" />
        <ControlSkeleton id="settings-skeleton-git-name" />
        <LineBone id="settings-skeleton-git-email-label" text="Email" className="mt-3 mb-1" textClassName="text-xs" width="w-12" />
        <ControlSkeleton id="settings-skeleton-git-email" />
        <TextSkeleton
          id="settings-skeleton-git-identity-hint"
          text="Stored in your global Git config. A repository can keep its own user.name and user.email."
          className="mt-1"
          textClassName="text-xs"
        />
      </section>

      <section id="settings-skeleton-git-defaults" className="mt-5">
        <LineBone id="settings-skeleton-git-defaults-heading" text="Defaults" textClassName="text-xs" width="w-16" />
        <LineBone id="settings-skeleton-git-branch-label" text="Default branch" className="mt-3 mb-1" textClassName="text-xs" width="w-28" />
        <ControlSkeleton id="settings-skeleton-git-branch" />
        <TextSkeleton
          id="settings-skeleton-git-branch-hint"
          text="Used when Git creates a repository. Leave this blank to keep Git's default. Pull still follows each repository's own default branch."
          className="mt-1"
          textClassName="text-xs"
        />
        <LineBone id="settings-skeleton-git-line-ending-label" text="Line endings" className="mt-3 mb-1" textClassName="text-xs" width="w-24" />
        <SelectSkeleton id="settings-skeleton-git-line-ending" />
        <TextSkeleton
          id="settings-skeleton-git-line-ending-hint"
          text="Stored in your global Git config as core.autocrlf."
          className="mt-1"
          textClassName="text-xs"
        />
      </section>
    </SkeletonPanel>
  );
}

function AiSkeleton() {
  return (
    <SkeletonPanel id="settings-panel-ai" labelledBy="settings-tab-ai">
      <TextSkeleton
        id="settings-skeleton-ai-intro"
        text="A key is saved in this computer's credential manager. Paste a new one only when you want to replace it."
        className="mt-4"
        textClassName="text-sm"
      />
      <LineBone id="settings-skeleton-ai-key-label" text="API key" className="mt-3 mb-1" textClassName="text-xs" width="w-14" />
      <div id="settings-skeleton-ai-key-row" className="flex items-center gap-2">
        <ControlSkeleton id="settings-skeleton-ai-key" className="min-w-0 flex-1" />
        <Bone id="settings-skeleton-ai-fetch" className="h-8 w-28 shrink-0" />
      </div>
      <div id="settings-skeleton-ai-model-thinking-row" className="flex items-start gap-2">
        <div id="settings-skeleton-ai-model-column" className="flex w-1/2 flex-col">
          <LineBone id="settings-skeleton-ai-model-label" text="Model" className="mt-3 mb-1" textClassName="text-xs" width="w-12" />
          <ControlSkeleton id="settings-skeleton-ai-model" />
        </div>
        <div id="settings-skeleton-ai-thinking-column" className="flex w-1/2 flex-col">
          <LineBone id="settings-skeleton-ai-thinking-label" text="Thinking" className="mt-3 mb-1" textClassName="text-xs" width="w-16" />
          <SelectSkeleton id="settings-skeleton-ai-thinking" />
        </div>
      </div>
      <div id="settings-skeleton-ai-prompts" className="mt-4">
        <LineBone id="settings-skeleton-ai-prompts-label" text="AI prompts" className="mb-1" textClassName="text-xs" width="w-20" />
        <div id="settings-skeleton-ai-prompt-tabs" className="flex overflow-hidden rounded-md border border-zinc-700">
          {Array.from({ length: PROMPT_SLOTS }, (_, index) => (
            <Bone id={`settings-skeleton-ai-prompt-tab-${index + 1}`} key={index} className="h-8 flex-1 rounded-none" />
          ))}
        </div>
        <TextareaSkeleton id="settings-skeleton-ai-prompt" rows={5} className="mt-2" />
      </div>
    </SkeletonPanel>
  );
}

function IgnoreSkeleton() {
  return (
    <SkeletonPanel id="settings-panel-ignore" labelledBy="settings-tab-ignore">
      <TextSkeleton
        id="settings-skeleton-ignore-intro"
        text="Hide folders in the repository list. Each line is a regular expression, matched without regard to letter case against the folder name and its full path. A match hides that folder and everything inside it."
        className="mt-4"
        textClassName="text-sm"
      />
      <LineBone
        id="settings-skeleton-ignore-label"
        text="Folder patterns"
        className="mt-4 mb-1"
        textClassName="text-xs"
        width="w-28"
      />
      <TextareaSkeleton id="settings-skeleton-ignore-pattern" rows={8} mono />
      <TextSkeleton
        id="settings-skeleton-ignore-hint"
        text="Leave this blank to show every folder. Use ^ and $ when a pattern should match the whole name, for example ^temp$."
        className="mt-1"
        textClassName="text-xs"
      />
    </SkeletonPanel>
  );
}

function SkeletonPanel({
  id,
  labelledBy,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} role="tabpanel" aria-labelledby={labelledBy} aria-busy="true" className={cn("pointer-events-none", className)}>
      <p id="settings-tab-skeleton-status" className="sr-only" role="status">
        Loading settings
      </p>
      {children}
    </div>
  );
}

function SkeletonSection({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3">
      <LineBone id={`${id}-heading`} text={title} textClassName="text-[11px] font-semibold tracking-wide uppercase" width="w-28" />
      <TextSkeleton id={`${id}-hint`} text={hint} className="mt-1" textClassName="text-xs leading-5" />
      <div id={`${id}-body`} className="mt-3">
        {children}
      </div>
    </section>
  );
}

function TextSkeleton({
  id,
  text,
  className,
  textClassName,
}: {
  id: string;
  text: string;
  className?: string;
  textClassName: string;
}) {
  return (
    <div id={id} className={cn("relative", className)}>
      <p id={`${id}-spacer`} aria-hidden="true" className={cn("invisible", textClassName)}>
        {text}
      </p>
      <div id={`${id}-fill`} aria-hidden="true" className={cn("settings-skeleton-lines absolute inset-0", textClassName)} />
    </div>
  );
}

function LineBone({
  id,
  text,
  className,
  textClassName,
  width,
}: {
  id: string;
  text: string;
  className?: string;
  textClassName: string;
  width: string;
}) {
  return (
    <div id={id} className={cn("relative", className)}>
      <p id={`${id}-spacer`} aria-hidden="true" className={cn("invisible", textClassName)}>
        {text}
      </p>
      <Bone id={`${id}-fill`} className={cn("absolute inset-y-0 left-0", width)} />
    </div>
  );
}

function ControlSkeleton({ id, className }: { id: string; className?: string }) {
  return (
    <div id={id} className={cn("relative", className)}>
      <input
        id={`${id}-spacer`}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="invisible w-full rounded-md border border-zinc-700 px-3 py-2 text-sm"
      />
      <Bone id={`${id}-fill`} className="absolute inset-0" />
    </div>
  );
}

function SelectSkeleton({ id }: { id: string }) {
  return (
    <div id={id} className="relative">
      <select
        id={`${id}-spacer`}
        tabIndex={-1}
        aria-hidden="true"
        className="invisible w-full rounded-md border border-zinc-700 px-3 py-2 text-sm"
      />
      <Bone id={`${id}-fill`} className="absolute inset-0" />
    </div>
  );
}

function TextareaSkeleton({ id, rows, mono = false, className }: { id: string; rows: number; mono?: boolean; className?: string }) {
  return (
    <div id={id} className={cn("relative", className)}>
      <textarea
        id={`${id}-spacer`}
        readOnly
        tabIndex={-1}
        rows={rows}
        aria-hidden="true"
        className={cn("invisible w-full resize-none rounded-md border border-zinc-700 px-3 py-2 text-sm", mono && "font-mono")}
      />
      <Bone id={`${id}-fill`} className="absolute inset-0" />
    </div>
  );
}

function Bone({ id, className }: { id: string; className?: string }) {
  return <div id={id} aria-hidden="true" className={cn("settings-skeleton-bone rounded-md", className)} />;
}
