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
    // `no-undef` is OFF on every linted file, deliberately; do not re-enable it "for safety". Every
    // file this config lints is type-checked (the project service refuses a file outside a
    // tsconfig), and TypeScript's checker reports an undefined name more accurately than
    // `no-undef` can. Turning it on needs a hand-kept list of globals: a second source of truth
    // that drifts from the real one, the same two-copies problem N1 forbids for controls.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: { "no-undef": "off" },
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
