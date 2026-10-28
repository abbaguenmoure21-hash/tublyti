import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // JSX text does not interpret \uXXXX escapes: they show up literally on screen.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[raw=/\\\\u[0-9a-fA-F]{4}/]",
          message: "Write the real character (é, —, ·…) instead of a \\u escape in JSX text.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
