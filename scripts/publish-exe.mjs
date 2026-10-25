import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = "production";
const releaseDir = join(root, "src-tauri", "target", "release");
const built = join(releaseDir, `${name}.exe`);
const assetName = `${name}_${String(version).split(".").join("_")}.exe`;
const assetPath = join(releaseDir, assetName);

if (!existsSync(built)) {
  console.error(`Expected build output at ${built}`);
  console.error("Run pnpm build:exe first.");
  process.exit(1);
}

copyFileSync(built, assetPath);
run(["release", "upload", tag, assetPath, "--clobber"]);

const release = JSON.parse(run(["release", "view", tag, "--json", "assets"], { capture: true }));
for (const asset of release.assets) {
  if (!asset.name.endsWith(".exe") || asset.name === assetName) continue;
  run(["release", "delete-asset", tag, asset.name, "--yes"]);
}

run(["release", "edit", tag, "--title", `v${version}`]);
console.log(`\nReplaced ${tag} with ${assetName}`);

function run(args, { capture = false } = {}) {
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}
