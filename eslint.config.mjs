import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "assets/**",
      "*.xlsx",
      "*.db",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      "no-async-promise-executor": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["main.js", "backup.js", "restore.js", "src/main/**/*.js", "scripts/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
]);
