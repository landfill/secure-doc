# Repository Guidelines

## Project Structure & Module Organization

This is an Electron + React/TypeScript secure document issuer. Main process code lives in `src/main/`, preload bridge code in `src/preload/`, shared crypto, plugin contracts, publish policy, branding, templates, and packaging logic live in `src/shared/`, and the React renderer lives in `src/renderer/src/`. Renderer HTML starts at `src/renderer/index.html`. Tests are in `tests/*.test.ts`, and design notes or durable security/API documentation belong in `docs/`. Build output is generated under `out/`; packaged installers go to `release/`. Do not edit generated output unless the task is explicitly about packaging artifacts.

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

## Documentation Sync

Keep `README.md` current whenever code changes affect user-facing behavior, setup, commands, packaging, security guarantees, plugin capabilities, publish policy, branding presets, document templates, or delivery/audit workflows. For deeper API or security contract changes, update the matching file in `docs/` as well. If a code change does not require README edits, say why in the final handoff or PR notes, for example `README unchanged: internal refactor only`.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative subjects such as `Fix desktop bridge and stabilize body editing`. Keep commits scoped to one behavior change. PRs should include a short problem statement, summary of changes, test evidence, and screenshots or screen recordings for renderer UI changes. Link related issues or docs when available.

## Branch Strategy

Use `main` only as the stable integration branch. For non-trivial work, create a short-lived branch from the current `main` using `codex/<scope>` unless the user asks for a different name. Use scoped names such as `codex/plugin-delivery-audit`, `codex/pin-policy-tests`, or `codex/renderer-publish-flow`. Keep each branch focused on one behavior change or one documentation cleanup; do not mix unrelated renderer, main-process, security, and packaging changes.

Before changing files, check the current branch and working tree. Do not overwrite or revert unrelated user changes. If the branch already contains unrelated work, continue with a minimal diff that avoids those files or create a separate branch when safe. Keep generated directories (`out/`, `release/`) and dependency folders out of commits unless the task explicitly requires them.

## Handoff Strategy

Every handoff should make the next owner productive without re-discovery. Include the current branch, base branch, changed files, intent, security-sensitive decisions, tests run, tests not run, and remaining risks. When work touches IPC, crypto, viewer HTML, plugin permissions, publish history, SMTP delivery, or package integrity, call that out explicitly.

If pausing mid-task, leave the repository in a reviewable state: no hidden generated changes, no unreported failing tests, and no unexplained TODOs. If a handoff includes follow-up work, list concrete next steps and the files most likely involved. If a PR is opened, put the same handoff facts in the PR body.

## Security & Configuration Tips

Do not store PINs, PIN hashes, plaintext document bodies, DEKs, or KEKs. Do not introduce `Math.random()`, browser storage, numeric PIN inputs, or external viewer resources. Preserve CSP restrictions and the offline single-HTML viewer model unless the security design is updated in `docs/` and the README security model is updated at the same time. Plugin behavior must stay allowlisted and main-process mediated; the renderer must not execute plugin implementation code or receive raw secrets.
