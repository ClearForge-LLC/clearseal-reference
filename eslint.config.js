import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/node_modules/", "**/dist/", "**/coverage/"] },
  js.configs.recommended,
  {
    // Every script and module extension, so no file in control source can sit outside the
    // type-aware rules (a `.mts` there was built and shipped but never linted).
    files: ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // This becomes a server: an unawaited promise in a gate is a fail-open. The root JS
      // (the test wrapper, which is itself the N5 gate) is type-checked via tsconfig.json.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // The Node globals the root JavaScript uses. `no-undef` is live on these files: under
    // `defineConfig`, typescript-eslint's override that switches it off applies to TypeScript only.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: { Buffer: "readonly", console: "readonly", performance: "readonly", process: "readonly" },
    },
  },
  // Suppression policy. Everywhere: a disable directive that suppresses nothing is an error, and
  // scripts/check-directives.mjs (run by `npm run lint`) requires every directive to carry a
  // `-- reason`. Control source: no inline directive of any kind is honoured; an exception there
  // is a config entry below, with a comment saying why, and so a review item. ESLint reports an
  // ignored directive in control source as a warning, so `--max-warnings 0` in `npm run lint` is
  // part of this policy, not a style choice.
  {
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
  },
  {
    files: ["packages/*/src/**"],
    linterOptions: { noInlineConfig: true },
  },
);
