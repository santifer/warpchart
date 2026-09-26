import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwind from "eslint-plugin-better-tailwindcss";
import { readFileSync } from "node:fs";

// Our own plain-CSS classes (.numeral, .hud, .rise…) live in globals.css
// outside Tailwind's registry; read them from the selectors so a new one is
// known the moment it is defined there, and only a real typo is flagged.
const OWN_CLASSES = [
  ...new Set(
    [...readFileSync(new URL("./src/app/globals.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "")
      .matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]),
  ),
].map((c) => `^${c}$`);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tailwind drops an unknown utility WITHOUT an error: `ring-panel` (no such
  // color token) silently fell back to currentColor and drew an inverted ring
  // in both themes. This makes an unknown class a lint error instead.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: { "better-tailwindcss": { entryPoint: "src/app/globals.css" } },
    rules: { "better-tailwindcss/no-unknown-classes": ["error", { ignore: OWN_CLASSES }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / vendored, not ours to lint.
    "seo-audit/**",
    "public/**",
  ]),
]);

export default eslintConfig;
