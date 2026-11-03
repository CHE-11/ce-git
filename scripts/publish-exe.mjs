import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;
const setupName = `${name}_${version}_x64-setup.exe`;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const setupPath = join(nsisDir, setupName);
const signaturePath = join(nsisDir, `${setupName}.sig`);
const manifestPath = join(nsisDir, "latest.json");
const notesPath = join(nsisDir, "release-notes.md");
const versionFiles = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"];

if (!existsSync(setupPath) || !existsSync(signaturePath)) {
  console.error(`Expected installer and signature at ${setupPath}`);
  console.error("Run pnpm build:exe first.");
  process.exit(1);
}

const tauriVersion = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
const cargoVersion = /^version = "([^"]+)"/m.exec(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"))?.[1];
if (tauriVersion !== version || cargoVersion !== version) {
  console.error("package.json, tauri.conf.json, and Cargo.toml must use the same version.");
  process.exit(1);
}

const dirty = spawnSync("git", ["diff", "--quiet", "HEAD", "--", ...versionFiles], { cwd: root });
if (dirty.error) {
  console.error(dirty.error.message);
  process.exit(1);
}
if (dirty.status === 1) {
  console.error("Commit the version bump before publishing.");
  process.exit(1);
}
if (dirty.status !== 0) {
  process.exit(dirty.status ?? 1);
}

const sha = git(["rev-parse", "HEAD"]);
const remote = spawnSync("gh", ["api", "--silent", `repos/{owner}/{repo}/commits/${sha}`], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (remote.error) {
  console.error(remote.error.message);
  process.exit(1);
}
if (remote.status !== 0) {
  console.error(`Commit ${sha.slice(0, 7)} is not on GitHub. Push this branch, then run pnpm publish:exe again.`);
  process.exit(remote.status ?? 1);
}

const slug = githubSlug();
const notes = releaseNotes(slug);
const signature = readFileSync(signaturePath, "utf8").trim();
const downloadUrl = `https://github.com/${slug}/releases/download/${tag}/${setupName}`;
const platform = { signature, url: downloadUrl };
writeFileSync(notesPath, `${notes}\n`);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": platform,
        "windows-x86_64-nsis": platform,
      },
    },
    null,
    2,
  )}\n`,
);

run([
  "release",
  "create",
  tag,
  setupPath,
  manifestPath,
  "--title",
  tag,
  "--target",
  sha,
  "--notes-file",
  notesPath,
  "--latest",
]);
console.log(`\nPublished ${tag} with ${setupName}`);

function releaseNotes(slug) {
  const previous = previousTag();
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const subjects = git(["log", range, "--pretty=%s"])
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean);
  const bullets = [];
  for (const subject of subjects) {
    if (/^chore(\([^)]+\))?: bump version\b/i.test(subject)) {
      continue;
    }
    const match = /^(feat|fix|perf)(\([^)]+\))?(!)?:\s+(.+)$/.exec(subject);
    if (!match) {
      continue;
    }
    const summary = sentence(match[4]);
    if (summary) {
      bullets.push(`- ${summary}`);
    }
  }
  if (bullets.length > 0) {
    return bullets.join("\n");
  }
  if (previous) {
    return `**Full Changelog**: https://github.com/${slug}/compare/${previous}...${tag}`;
  }
  return `**Full Changelog**: https://github.com/${slug}/releases/tag/${tag}`;
}

function previousTag() {
  const tags = git(["tag", "--sort=-v:refname"])
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return tags.find((item) => item !== tag) ?? null;
}

function sentence(value) {
  const text = value.trim().replace(/\.+$/, "");
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function githubSlug() {
  const url = git(["remote", "get-url", "origin"]);
  const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(url);
  if (!match) {
    console.error(`Origin is not a GitHub repository: ${url}`);
    process.exit(1);
  }
  return `${match[1]}/${match[2]}`;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return (result.stdout ?? "").trim();
}

function run(args) {
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
