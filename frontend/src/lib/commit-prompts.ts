import type { AiPrompts } from "../../../types/git";

export const DESCRIPTIVE_PROMPT =
  "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters. After a blank line, write a description of two to six sentences that says what changed and why. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

export const QUICK_PROMPT =
  "You write git commit messages. Reply with one conventional commit subject and nothing else. The line is `type: summary` or `type(scope): summary`, at most 72 characters. Do not add a body. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

export function withDefaultPrompts(value: AiPrompts | undefined): AiPrompts {
  const prompts = [0, 1, 2].map((index) => (typeof value?.[index] === "string" ? value[index] : "")) as AiPrompts;
  if (!prompts[0].trim()) {
    prompts[0] = DESCRIPTIVE_PROMPT;
  }
  if (!prompts[1].trim()) {
    prompts[1] = QUICK_PROMPT;
  }
  return prompts;
}
