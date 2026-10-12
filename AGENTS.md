# AGENTS.md

Guidance for AI agents and new contributors working on `dcsh`.

## What this is

`dcsh` is a mongosh-style REPL that drives the Discord REST API (v10) as a bot account. It never
connects to the gateway. See `README.md` for usage and the safety guards (audit-log reason,
read-only mode, no raw client).

## Toolchain

- **Language:** TypeScript (ESM, NodeNext). Import specifiers keep the `.js` extension.
- **Runtime:** Node >= 22 (CI runs 24.x).
- **Package manager:** pnpm. Run `pnpm install` after cloning.
- **Build:** `pnpm build` (`tsc` -> `dist/`). The `dcsh` bin points at `dist/bin/dcsh.js`. `pnpm dev` runs source directly via `tsx`.
- **Tests:** `pnpm test` (vitest). Tests live in `tests/`, cover the pure and guard logic (config parsing, token precedence, the mutation guard, statement parsing).
- **Lint/format:** `pnpm lint` (eslint + prettier --check), `pnpm format` (prettier --write). Prettier is the formatting authority; the `.editorconfig` is a minimal editor baseline only.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/), enforced by a husky `commit-msg` hook. Use `ci:`/`chore:`/`docs:` for non-shipping changes; reserve `feat:`/`fix:` for release-worthy changes.
- **Pre-commit:** runs `pnpm lint` and, where `gitleaks` is installed, a staged secret scan.
- **Dependencies:** managed by the shared Arkanis Renovate preset (`renovate.json5`).
- **CI:** `.github/workflows/build.yml` consumes the shared `ArkanisCorporation/ci` reusable Node workflows (lint, test, build) plus GitHub Actions linting.

## Layout

```
bin/dcsh.ts      REPL entry: arg parsing, token resolution, eval/completer wiring
src/config.ts    config file loading, token-source resolution
src/session.ts   REST session + the guarded api (reason/read-only enforcement)
src/commands.ts  statement grammar: parse() and dispatch()
src/types.ts     shared types (TokenSource, Config, Statement, GuardedApi)
tests/           vitest suites
```

The completer in `bin/dcsh.ts` and the grammar in `src/commands.ts` are kept as a deliberate seam
for future richer completion (see the autosuggestions follow-up issue).

## Design rationale

The repo-standards baseline and the JS -> TS migration are documented in
`docs/superpowers/specs/2026-10-09-dcsh-repo-standards-and-ts-migration-design.md`.
