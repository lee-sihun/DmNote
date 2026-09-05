import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "src/renderer/wasm/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // React Hooks
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "warn",
    },
  },

  // React Refresh (Vite HMR)
  {
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Project-specific rules
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        __APP_VERSION__: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // JSX files
  {
    files: ["**/*.jsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    files: ["scripts/ci/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  // Prettier must be last to override formatting rules
  eslintConfigPrettier,
);
