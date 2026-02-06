const js = require("@eslint/js");
const vue = require("eslint-plugin-vue");
const jsdoc = require("eslint-plugin-jsdoc");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const vueParser = require("vue-eslint-parser");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

const sharedRules = {
    yoda: "error",
    eqeqeq: ["warn", "smart"],
    camelcase: [
        "warn",
        {
            properties: "never",
            ignoreImports: true,
        },
    ],
    "no-unused-vars": [
        "warn",
        {
            args: "none",
        },
    ],
    "vue/max-attributes-per-line": "off",
    "vue/singleline-html-element-content-newline": "off",
    "vue/html-self-closing": "off",
    "vue/require-component-is": "off", // not allow is="style" https://github.com/vuejs/eslint-plugin-vue/issues/462#issuecomment-430234675
    "vue/attribute-hyphenation": "off", // This change noNL to "no-n-l" unexpectedly
    "vue/multi-word-component-names": "off",
    "vue/no-reserved-component-names": "off",
    curly: "error",
    "no-var": "error",
    "no-throw-literal": "error",
    "no-constant-condition": [
        "error",
        {
            checkLoops: false,
        },
    ],
    //"no-console": "warn",
    "no-extra-boolean-cast": "off",
    "no-unneeded-ternary": "error",
    //"prefer-template": "error",
    "no-empty": [
        "error",
        {
            allowEmptyCatch: true,
        },
    ],
    "no-control-regex": "off",
    "one-var": ["error", "never"],
    "max-statements-per-line": ["error", { max: 1 }],
    "jsdoc/check-tag-names": [
        "error",
        {
            definedTags: ["link"],
        },
    ],
    "jsdoc/no-undefined-types": "off",
    "jsdoc/no-defaults": ["error", { noOptionalParamNames: true }],
    "jsdoc/require-throws": "warn",
    "jsdoc/require-jsdoc": [
        "error",
        {
            require: {
                FunctionDeclaration: true,
                MethodDefinition: true,
            },
        },
    ],
    "jsdoc/no-blank-block-descriptions": "error",
    "jsdoc/require-returns-description": "warn",
    "jsdoc/require-returns-check": ["error", { reportMissingReturnForUndefinedTypes: false }],
    "jsdoc/require-returns": [
        "warn",
        {
            forceRequireReturn: true,
            forceReturnsWithAsync: true,
        },
    ],
    "jsdoc/require-param-type": "warn",
    "jsdoc/require-param-description": "warn",
    "jsdoc/require-throws-type": "off",
    "jsdoc/valid-types": "off",
    "jsdoc/reject-any-type": "off",
    "jsdoc/ts-no-empty-object-type": "off",
    "jsdoc/reject-function-type": "off",
};

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const tsRecommended = tsPlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: config.files ?? tsFiles,
}));

module.exports = [
    {
        ignores: [
            "node_modules",
            ".DS_Store",
            "dist",
            "dist-ssr",
            "*.local",
            ".idea",
            "data",
            "data*",
            ".vscode",
            "private",
            "out",
            "tmp",
            ".env",
            "extra/healthcheck.exe",
            "extra/healthcheck",
            "extra/healthcheck-armv7",
            "extra/healthcheck-src/healthcheck-armv7",
            "extra/exe-builder/bin",
            "extra/exe-builder/obj",
            ".vs",
            ".npm-cache",
            "**/*.mjs",
            "**/*.cjs",
            "**/*.ts",
            "**/*.tsx",
            "**/*.mts",
            "**/*.cts",
            "test/*.js",
            "server/modules/*",
            "src/util.js",
        ],
    },
    js.configs.recommended,
    ...vue.configs["flat/recommended"],
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.commonjs,
            },
        },
    },
    {
        files: ["**/*.{js,vue}"],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tsParser,
                sourceType: "module",
                ecmaVersion: 2020,
                requireConfigFile: false,
            },
        },
        plugins: {
            vue,
            jsdoc,
            "@typescript-eslint": tsPlugin,
        },
        rules: sharedRules,
    },
    {
        files: tsFiles,
        rules: sharedRules,
    },
    ...tsRecommended,
    {
        files: tsFiles,
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                sourceType: "module",
                ecmaVersion: 2020,
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            jsdoc,
        },
        rules: {
            "jsdoc/require-returns-type": "off",
            "jsdoc/require-param-type": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-require-imports": "off",
            "prefer-const": "off",
        },
    },
    {
        rules: prettier.rules,
    },
];
