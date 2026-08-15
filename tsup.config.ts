import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    format: ["esm"],
    platform: "node",
    outDir: "dist-electron",
    sourcemap: true,
    clean: false,
    external: ["electron", "tether-agent-core"],
    outExtension: () => ({ js: ".mjs" }),
  },
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: ["cjs"],
    platform: "node",
    outDir: "dist-electron",
    sourcemap: true,
    clean: false,
    external: ["electron"],
    outExtension: () => ({ js: ".cjs" }),
  },
  {
    entry: { "extensions/vision": "src/extensions/vision.ts" },
    format: ["esm"],
    platform: "node",
    outDir: "dist-electron",
    sourcemap: false,
    clean: false,
    outExtension: () => ({ js: ".js" }),
  },
]);
