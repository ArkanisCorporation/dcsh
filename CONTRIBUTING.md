# Contributing to dcsh

Thanks for your interest in improving `dcsh`. This guide covers the development setup and the
conventions the project follows.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

`dcsh` is a TypeScript (ESM) CLI. You need **Node.js 22.13 or newer** and **pnpm**.

```sh
git clone https://github.com/ArkanisCorporation/dcsh.git
cd dcsh
pnpm install
pnpm dev --help      # run the shell straight from source via tsx
```

## Development workflow

```sh
pnpm dev             # run the shell from source (tsx)
pnpm test            # run the vitest suite
pnpm test:watch      # vitest in watch mode
pnpm lint            # tsc (incl. tests) + eslint + prettier --check
pnpm format          # prettier --write
pnpm build           # compile to dist/
pnpm validate        # the full gate CI runs: lint + test + build
```

Run `pnpm validate` before opening a pull request - it is exactly what CI checks, so a green
`validate` means a green CI. A `pre-push` git hook runs it for you automatically.

Tests live in `tests/` and cover the pure and guard logic (config parsing, token precedence, the
mutation guard, statement parsing). New behaviour should come with a test.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are enforced by a
`commit-msg` git hook. The type drives releases, so pick it deliberately:

- `feat:` / `fix:` / `perf:` - ships in a release.
- `ci:` / `build:` / `chore:` / `docs:` / `refactor:` / `test:` / `style:` - does not ship.

Keep each commit a single logical change.

## Pull requests

1. Fork and branch from `main`.
2. Make your change with tests and docs.
3. Ensure `pnpm validate` is green.
4. Open a PR describing the _why_, not just the _what_. Fill in the PR template.

## A note on the Arkanis internal tooling

Two conveniences in this repo depend on **private** Arkanis infrastructure and are not needed to
contribute:

- CI runs through the shared `ArkanisCorporation/ci` reusable workflows. External forks run their
  own copy; `pnpm validate` reproduces the same checks locally.
- `pnpm act` runs the CI workflow in Docker and needs access to those private workflows, so it only
  works for Arkanis members. It is a convenience, never a requirement - `pnpm validate` is the
  universal gate.

Everything you need to develop, test, and verify `dcsh` works with a plain `pnpm install`.
