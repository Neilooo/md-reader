// @ts-check
import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import vueParser from "vue-eslint-parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "src-tauri/target/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        sourceType: "module",
        ecmaVersion: 2022,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "no-unused-vars": "off",
    },
  },
  {
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        fetch: "readonly",
        process: "readonly",
        Node: "readonly",
        NodeFilter: "readonly",
        Range: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLImageElement: "readonly",
        HTMLAnchorElement: "readonly",
        HTMLSelectElement: "readonly",
        SVGSVGElement: "readonly",
        Text: "readonly",
        CSS: "readonly",
        Event: "readonly",
        KeyboardEvent: "readonly",
        PointerEvent: "readonly",
        ClipboardEvent: "readonly",
        File: "readonly",
        WheelEvent: "readonly",
        Element: "readonly",
        btoa: "readonly",
        Uint8Array: "readonly",
      },
    },
    rules: {
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/attributes-order": "off",
    },
  },
];
