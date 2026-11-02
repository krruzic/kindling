# Package conventions (for everyone building a Kindling package)

- Monorepo, pnpm workspace. Each package lives in `packages/<name>`, is published as `@kindling/<name>`, and has:
  `package.json` (`"name": "@kindling/<name>"`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }` (+ subpath
  exports if useful), `"scripts": { "typecheck": "tsc -p .", "test": "node --experimental-transform-types --no-warnings test/run.ts" }`),
  `tsconfig.json` extending `../../tsconfig.base.json` with `"include": ["src", "test"]`, `src/index.ts`, `test/`,
  and a `README.md` (what it is, why (link to docs/LESSONS.md sections), API, usage snippet, how it was used in Grudge).
- Source is TypeScript consumed directly (no build step): Vite in browsers, `node --experimental-transform-types` in
  node. Use explicit `.ts` extensions in relative imports (Node needs them).
- Cross-package imports via `@kindling/<name>` workspace deps (`"@kindling/core": "workspace:*"`).
- Game-agnostic: no Grudge heroes, maps or data. Anything game-specific becomes a parameter, callback or generic type.
- Deterministic code (core sim helpers) must not use Math.random / Date / performance.now / DOM.
- Prettier 120 columns; sparse logical comments; a header comment per file explaining the module.
- Tests: plain node scripts under `test/` with a tiny assert runner (no test framework dependency); `pnpm test` must pass.
- Commit with `git commit --no-gpg-sign`. Stage only your own package directory (and docs you own).
