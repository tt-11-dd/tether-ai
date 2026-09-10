/**
 * Dev launcher for `pnpm dev`.
 *
 * The previous command was `env -u ELECTRON_RUN_AS_NODE cross-env VITE_DEV_SERVER_URL=... electron .`,
 * which cannot work on Windows: `env` is not a Windows tool and `cross-env` can set variables but
 * cannot unset them. Doing both in Node keeps the dev command identical on macOS, Linux and Windows.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// In a plain Node process the electron package resolves to the path of its binary.
const electronBinary = require("electron");

const env = { ...process.env };
// Leaked from a terminal or IDE that itself runs inside Electron; Electron would start in
// Node mode and never open a window.
delete env.ELECTRON_RUN_AS_NODE;
env.VITE_DEV_SERVER_URL ??= "http://127.0.0.1:5177";

const child = spawn(electronBinary, ["."], { stdio: "inherit", env });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Failed to start Electron: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
