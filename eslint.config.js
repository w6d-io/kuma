import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat config (ESLint 9+/10). kuma is type:module + Vite/React 19 + TS.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/seed.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Rule names are stable across plugin versions (safer than spreading configs).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Retrofit baseline: this repo never linted. Surface `any` as a warning to
      // clean up incrementally rather than block on a 28-site refactor. Tighten to
      // "error" once the existing `any`s are typed.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
