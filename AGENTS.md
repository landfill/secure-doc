# Repository Guidelines

## Project Structure & Module Organization

This is an Electron + React/TypeScript secure document issuer. Main process code lives in `src/main/`, preload bridge code in `src/preload/`, shared crypto and packaging logic in `src/shared/`, and the React renderer in `src/renderer/src/`. Renderer HTML starts at `src/renderer/index.html`. Tests are in `tests/*.test.ts`, and planning or design notes belong in `docs/`. Build output is generated under `out/`; packaged installers go to `release/`.

## Build, Test, and Development Commands

- `npm install` installs Electron, Vite, React, TypeScript, and test dependencies.
- `npm run dev` starts the Electron/Vite development app.
- `npm run build` runs `tsc --noEmit` and builds the Electron app into `out/`.
- `npm test` runs Node's built-in test runner with TypeScript stripping against `tests/*.test.ts`.
- `npm run fix:electron` repairs a missing Electron runtime download.
- `npm run make:mac` and `npm run make:win` build installer packages in `release/`.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Keep two-space indentation, double quotes, semicolons omitted, and named exports where practical. React components use `PascalCase`; functions, variables, and test helpers use `camelCase`; type aliases use `PascalCase`. Keep security-sensitive helpers in `src/shared/` so they can be tested outside Electron.

## Testing Guidelines

Use `node:test` and `node:assert/strict`. Name tests `*.test.ts` and place them in `tests/`. Add focused regression tests for PIN policy, packaging, viewer security, and static security constraints. Run `npm test` before submitting changes; run `npm run build` when TypeScript, Electron, or packaging behavior changes.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative subjects such as `Fix desktop bridge and stabilize body editing`. Keep commits scoped to one behavior change. PRs should include a short problem statement, summary of changes, test evidence, and screenshots or screen recordings for renderer UI changes. Link related issues or docs when available.

## Security & Configuration Tips

Do not store PINs, PIN hashes, plaintext document bodies, DEKs, or KEKs. Do not introduce `Math.random()`, browser storage, numeric PIN inputs, or external viewer resources. Preserve CSP restrictions and the offline single-HTML viewer model unless the security design is updated in `docs/`.
