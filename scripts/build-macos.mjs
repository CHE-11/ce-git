import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const target = "aarch64-apple-darwin";
const binaryName = `${name}_${String(version).split(".").join("_")}`;
const releaseDir = join(root, "src-tauri", "target", target, "release");
const source = join(releaseDir, name);
const destination = join(releaseDir, binaryName);

if (process.platform !== "darwin") {
  console.error("Run pnpm build:app on macOS. This script targets Apple Silicon.");
  process.exit(1);
}

const child = spawn(`pnpm tauri build --target ${target} --no-bundle`, {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code !== 0) {
    process.exit(code ?? 1);
  }

  if (!existsSync(source)) {
    console.error(`Expected build output at ${source}`);
    process.exit(1);
  }

  rmSync(destination, { force: true });
  renameSync(source, destination);
  console.log(`\nBuilt ${destination}`);
});
