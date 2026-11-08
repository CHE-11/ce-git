import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const hosts = {
  x64: { target: "x86_64-unknown-linux-gnu", arch: "amd64" },
  arm64: { target: "aarch64-unknown-linux-gnu", arch: "aarch64" },
};
const host = hosts[process.arch];
const keyFile = join(homedir(), ".tauri", "ce-git.key");

if (process.platform !== "linux") {
  console.error("Run pnpm build:linux on Linux.");
  process.exit(1);
}

if (!host) {
  console.error(`Run pnpm build:linux on x64 or arm64 Linux. This machine is ${process.arch}.`);
  process.exit(1);
}

const appImageName = `${name}_${version}_${host.arch}.AppImage`;
const bundleDir = join(root, "src-tauri", "target", host.target, "release", "bundle", "appimage");
const output = join(bundleDir, appImageName);
const signature = join(bundleDir, `${appImageName}.sig`);

if (!existsSync(keyFile)) {
  console.error(`No signing key at ${keyFile}`);
  process.exit(1);
}

const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyFile,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
};

const child = spawn(`pnpm tauri build --target ${host.target} --bundles appimage`, {
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
    console.error(`Expected AppImage and signature at ${output}`);
    process.exit(1);
  }

  console.log(`\nBuilt ${output}`);
});
