import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const binaryName = `${name}_${String(version).split(".").join("_")}.exe`;
const releaseDir = join(root, "src-tauri", "target", "release");
const source = join(releaseDir, `${name}.exe`);
const destination = join(releaseDir, binaryName);

const child = spawn("pnpm tauri build --no-bundle", {
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
