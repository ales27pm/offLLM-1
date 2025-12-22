// eslint.config.mjs
import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      // build outputs
      "coverage/",
      "dist/",
      "build/",

      // deps / package managers
      "node_modules/",

      // python virtualenvs (your lint was walking into these)
      ".venv/",
      ".venv/**",
      "venv/",
      "venv/**",
      "**/.venv/**",
      "**/venv/**",

      // common caches / generated dirs
      ".cache/",
      ".cache/**",
      "__pycache__/",
      "__pycache__/**",
      "DerivedData/",
      "DerivedData/**",
      "reports/",
      "reports/**",
      "runs/",
      "runs/**",
      "unsloth_compiled_cache/",
      "unsloth_compiled_cache/**",

      // mobile build artifacts
      "ios/build/",
      "ios/Pods/",
      "android/app/build/",
      "android/.gradle/",
      "android/.idea/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
      },
    },
    plugins: {
      react: reactPlugin,
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/jsx-uses-vars": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
      },
    },
    plugins: {
      react: reactPlugin,
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/jsx-uses-vars": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },
];
