import { defineConfig } from "eslint/config";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { ESLint } from "eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

/** @type {ESLint.ConfigData} */
export default defineConfig([{
    languageOptions: {
        globals: {
            ...globals.browser,
            ...globals.greasemonkey,
        },

        ecmaVersion: 11,
        sourceType: "script",
    },

    rules: {
        curly: "warn",
        "dot-location": ["error", "property"],
        eqeqeq: "warn",
        "linebreak-style": ["error", "unix"],
        "no-else-return": "warn",
        "no-eval": "error",
        "no-octal": "error",
        "no-with": "error",
        radix: "error",
        "brace-style": "warn",
        camelcase: "error",
        indent: [4, "space"],
        "no-array-constructor": "error",

        quotes: ["error", "double", {
            allowTemplateLiterals: true,
            avoidEscape: true,
        }],

        "arrow-spacing": "error",
        "no-var": "error",
        "no-unused-vars": "warn",
    },
}, {
    files: ["**/*.user.js"],
    extends: compat.extends("plugin:userscripts/recommended"),

    settings: {
        userscriptVersions: {
            tampermonkey: ">=4",
            violentmonkey: ">=2",
            greasemonkey: "*",
        },
    },

    rules: {
        "userscripts/align-attributes": ["error", 1],
        "userscripts/compat-headers": "error",
    },
}]);