module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  env: {
    node: true,
    es2020: true,
  },
  rules: {
    // TypeScript
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/no-namespace": "off",

    // General
    "no-console": "warn",
    "prettier/prettier": "warn",
  },
  overrides: [
    {
      files: ["src/scripts/**/*.ts"],
      rules: {
        "no-console": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-explicit-any": "off"
      }
    }
  ],
  ignorePatterns: ["dist/", "node_modules/", "prisma/"],
};
