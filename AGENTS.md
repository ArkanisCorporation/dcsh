# AGENTS.md

Guidance for AI agents and new contributors working on `dcsh`.

## What this is

`dcsh` is a mongosh-style REPL that drives the Discord REST API (v10) as a bot account. It never
connects to the gateway. See `README.md` for usage and the safety guards (audit-log reason,
read-only mode, no raw client).

## Toolchain

- **Language:** TypeScript (ESM, NodeNext). Import specifiers keep the `.js` extension.
- **Runtime:** Node `^22.13 || >=23.5` (the floor of `@inquirer/prompts`; CI runs 24.x).
- **Package manager:** pnpm. Run `pnpm install` after cloning.
- **Build:** `pnpm build` (`tsc` -> `dist/`). The `dcsh` bin points at `dist/bin/dcsh.js`. `pnpm dev` runs source directly via `tsx`.
- **Tests:** `pnpm test` (vitest). Tests live in `tests/`, cover the pure and guard logic (config parsing/saving, token precedence, the mutation guard, statement parsing, credential templates, and the profile wizard driven by scripted prompts).
- **Lint/format:** `pnpm lint` (`tsc` type-check incl. tests via `tsconfig.test.json`, then eslint + prettier --check), `pnpm format` (prettier --write). Prettier is the formatting authority; the `.editorconfig` is a minimal editor baseline only.
- **Local CI:** `pnpm validate` runs the full gate (lint + test + build) and is what the `pre-push` hook runs. `pnpm act` runs the actual `build` workflow in Docker via [nektos/act](https://github.com/nektos/act) for full fidelity (incl. the actionlint job); it needs Docker running and a GitHub token (gh CLI auth or `GITHUB_TOKEN`) to fetch the private `ArkanisCorporation/ci` reusable workflows. The pinned act binary is checksum-verified into `.act/` by `scripts/get-act.sh`.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/), enforced by a husky `commit-msg` hook. Use `ci:`/`chore:`/`docs:` for non-shipping changes; reserve `feat:`/`fix:` for release-worthy changes.
- **Pre-commit:** runs `pnpm lint` and, where `gitleaks` is installed, a staged secret scan. **Pre-push:** runs `pnpm validate` (the full CI gate) before a push leaves the machine.
- **Dependencies:** managed by the shared Arkanis Renovate preset (`renovate.json5`).
- **CI:** `.github/workflows/build.yml` consumes the shared `ArkanisCorporation/ci` reusable Node workflows (lint, test, build) plus GitHub Actions linting.
- **Release:** `.github/workflows/release.yml` runs semantic-release (`.releaserc.json`) on push to `main` - version/changelog/tag/GitHub-release, then a `build-package` job (packs the tarball, no `id-token`) and a minimal `publish-npm` job that publishes the packed tarball via trusted publishing (OIDC, no `NPM_TOKEN`, provenance). The publish job holds `id-token: write` but runs no build/dependency scripts, isolating the OIDC credential from untrusted dependency code. Dormant until the `RELEASE_ENABLED` repo variable is `true`; publishing additionally needs a trusted publisher configured on npm for this repo + `release.yml` + the `release` environment.
- **Pages:** `.github/workflows/pages.yml` deploys the static `site/` landing page to `dcsh.arkanis.space` (custom domain via `site/CNAME`).

## Layout

```
bin/dcsh.ts         entry: `profile` subcommand, first-run onboarding, arg parsing, REPL wiring
src/config.ts       config file loading/saving, token-source resolution
src/credentials.ts  credential templates (1Password, command, env, file, prompt) -> TokenSource
src/profiles.ts     profile wizard (@inquirer/prompts), `dcsh profile` CRUD, first-run onboarding
src/session.ts      REST session + the guarded api (reason/read-only enforcement)
src/commands.ts     statement grammar: parse() and dispatch()
src/types.ts        shared types (TokenSource, Config, Statement, GuardedApi)
tests/              vitest suites
```

The completer in `bin/dcsh.ts` and the grammar in `src/commands.ts` are kept as a deliberate seam
for future richer completion (see the autosuggestions follow-up issue).

## Onboarding and profiles

- First-run setup triggers only for bare `dcsh` (no args) with no config file and an interactive stdin/stdout. Keep it that way: scripts and flag users must never hit a questionnaire.
- The config never holds a literal token. Templates only produce existing `TokenSource` shapes; a profile without `token` means "prompt at startup". 1Password is stored as argv `["op", "read", "<ref>"]`, or `["op", "--account", "<addr>", "read", "<ref>"]` when account-scoped (no shell). `parseOnePassword` recognises only these two shapes, anything else edits as a custom command.
- The wizard takes injectable `prompts`/`verify`/`log`, so tests drive it without a TTY or token. Add new questions there and extend the scripted answers in `tests/profiles.test.ts`.

## Design rationale

The repo-standards baseline and the JS -> TS migration are documented in
`docs/superpowers/specs/2026-10-09-dcsh-repo-standards-and-ts-migration-design.md`.
