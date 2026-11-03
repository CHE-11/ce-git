import type { AiPrompts } from "../../../types/git";

export const DESCRIPTIVE_PROMPT =
  "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters, and names the whole change set. After a blank line, write a description of two to six sentences that covers each distinct change. Group related files. Do not describe only the first file. A shortened diff excerpt is a sample; the changed-files list is complete. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

export const QUICK_PROMPT =
  "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters, and names the whole change set. After a blank line, write one short sentence that covers the whole change set, not only the first file. A shortened diff excerpt is a sample; the changed-files list is complete. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

const PREVIOUS_DESCRIPTIVE_PROMPT =
  "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters. After a blank line, write a description of two to six sentences that says what changed and why. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

const PREVIOUS_QUICK_PROMPT =
  "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters. After a blank line, write one short sentence that says what changed and why. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

export function withDefaultPrompts(value: AiPrompts | undefined): AiPrompts {
  const prompts = [0, 1, 2].map((index) => (typeof value?.[index] === "string" ? value[index] : "")) as AiPrompts;
  if (isBlankOrLegacy(prompts[0], PREVIOUS_DESCRIPTIVE_PROMPT)) {
    prompts[0] = DESCRIPTIVE_PROMPT;
  }
  if (isBlankOrLegacy(prompts[1], PREVIOUS_QUICK_PROMPT)) {
    prompts[1] = QUICK_PROMPT;
  }
  return prompts;
}

function isBlankOrLegacy(value: string, legacy: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === legacy;
}
