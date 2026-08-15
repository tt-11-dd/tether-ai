import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dir = path.dirname(require.resolve("electron/package.json"));
const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const relative = process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32"
    ? "electron.exe"
    : "electron";
const dist = path.join(dir, "dist");
const binary = path.join(dist, relative);
const frameworks = path.join(dist, "Electron.app/Contents/Frameworks/Electron Framework.framework");

function installed() {
  return fs.existsSync(binary) && (process.platform !== "darwin" || fs.existsSync(frameworks));
}

function cachedZip() {
  const zipName = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const root = path.join(os.homedir(), "Library/Caches/electron");
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name, zipName);
    if (fs.existsSync(candidate)) return candidate;
  }
}

if (!installed()) {
  spawnSync(process.execPath, [path.join(dir, "install.js")], { stdio: "inherit" });
}

if (!installed() && process.platform === "darwin") {
  const zip = cachedZip();
  if (!zip) {
    console.error("Electron binary is incomplete and no cached zip was found.");
    process.exit(1);
  }
  fs.mkdirSync(dist, { recursive: true });
  const result = spawnSync("unzip", ["-o", zip, "-d", dist], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (installed()) fs.writeFileSync(path.join(dir, "path.txt"), relative);

if (process.platform === "darwin") {
  const plist = path.join(dist, "Electron.app/Contents/Info.plist");
  if (fs.existsSync(plist)) {
    const name = "Tether";
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      const replace = spawnSync("plutil", ["-replace", key, "-string", name, plist]);
      if (replace.status !== 0) spawnSync("plutil", ["-insert", key, "-string", name, plist]);
    }
  }
}
