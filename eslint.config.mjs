import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const globals = {
  React: "readonly",
  Request: "readonly",
  Response: "readonly",
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  navigator: "readonly",
  setTimeout: "readonly",
  window: "readonly"
};

export default [
  {
    // vendor/ holds third-party engine code kept as published upstream.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "vendor/**"]
  },
  js.configs.recommended,
  {
    rules: {
      "preserve-caught-error": "off"
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: "./tsconfig.json",
        sourceType: "module"
      },
      globals
    },
    plugins: {
      "@next/next": nextPlugin,
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    },
    settings: {
      next: {
        rootDir: "."
      }
    }
  }
];
