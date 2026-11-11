import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const setupName = `${name}_${version}_x64-setup.exe`;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const output = join(nsisDir, setupName);
const signature = join(nsisDir, `${setupName}.sig`);
const keyPath = join(homedir(), ".tauri", "ce-git.key");


const keyFile = "S:/_keys_/ce-git/ce-git.key";
if (!existsSync(keyFile)) {
  console.error(`No signing key at ${keyFile}`);
  process.exit(1);
}

const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyFile,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
};

const child = spawn("pnpm tauri build --bundles nsis", {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code !== 0) {
    process.exit(code ?? 1);
  }

  if (!existsSync(output) || !existsSync(signature)) {
    console.error(`Expected installer and signature at ${output}`);
    process.exit(1);
  }

  console.log(`\nBuilt ${output}`);
});
