/**
 * Flat ESLint config for the Tether desktop app.
 *
 * The dependencies could not be installed in the sandboxed authoring environment (the pnpm store
 * that node_modules links against is read-only, and switching stores would have forced a full
 * reinstall of every dependency). Enable it with one command:
 *
 *   pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks \
 *     eslint-plugin-react-refresh globals
 *
 * Then `pnpm lint`. Nothing in `pnpm check` runs ESLint yet — add `pnpm lint` to that script only
 * after the first run is clean.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-electron",
      "release",
      "node_modules",
      ".pnpm-store",
      ".tether-tmp",
      "build",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // `react-hooks` v5/v6 differ in how their shared configs are shaped, so the two rules this
      // repo actually cares about are declared explicitly instead of spread from a preset.
      // `exhaustive-deps` is the rule that would have caught the stale-closure risks in App.tsx.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
      // The codebase leans on intentional empty catches with explanatory comments.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Kept as a warning so the first run reports the surface without failing outright.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
