# dcsh: Discord REST shell

[![npm](https://img.shields.io/npm/v/@arkanis-corporation/dcsh)](https://www.npmjs.com/package/@arkanis-corporation/dcsh)
[![build](https://github.com/ArkanisCorporation/dcsh/actions/workflows/build.yml/badge.svg)](https://github.com/ArkanisCorporation/dcsh/actions/workflows/build.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A mongosh-style REPL that acts as a bot account over the Discord REST API (v10). It never connects to the gateway, so it can't interfere with the running bot's session. It does share that bot's rate-limit buckets.

Website: **[dcsh.arkanis.space](https://dcsh.arkanis.space)**

## Getting started

```sh
npm install -g @arkanis-corporation/dcsh
dcsh
```

Requires Node.js 22.13 or newer. You supply your own bot token; dcsh never ships or stores one (see [Token sources](#token-sources)).

The first time you run plain `dcsh` in a terminal, it walks you through creating a bot profile and then drops you into the shell. It asks for:

1. **A profile name** (`default` for the first one).
2. **Where the token comes from:** 1Password, a custom command, an environment variable, a token file, or "ask every time". See [Credential templates](#credential-templates).
3. **An optional token check** against Discord. When the check succeeds, you pick the default server from a list.
4. **Read-only mode**, and whether the profile is the default.

The setup only starts for bare `dcsh` (no arguments), when no config file exists yet and stdin/stdout are a terminal. Any flag, such as `--token-env`, skips it.

### Managing profiles

```sh
dcsh profile list            # name, default, credential, default server, read-only
dcsh profile add [name]      # same guided questions as the first run
dcsh profile edit [name]     # answers pre-filled from the current profile; renames carry the default along
dcsh profile remove [name]   # asks first (-y to skip); hands the default to another profile
```

Leave out `[name]` and dcsh lets you pick the profile from a list. `--config <path>` works here too.

## Quick start

```
dcsh -p arkanis-main
arkanis-main> show servers
arkanis-main> use Arkanis
arkanis-main/Arkanis> show channels squad
arkanis-main/Arkanis> reason orphaned VC after sync bug
arkanis-main/Arkanis> await api.delete(Routes.channel('1234567890123456789'))
```

Type `help` in the shell for the full statement list.

## Development

dcsh is written in TypeScript (ESM) and built with `tsc` to `dist/`; the `dcsh` bin runs the compiled output. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

```
pnpm dev            # run the shell straight from source via tsx
pnpm test           # run the vitest suite
pnpm lint           # tsc (incl. tests) + eslint + prettier --check
pnpm build          # compile to dist/
pnpm typecheck      # type-check sources and tests (tsconfig.test.json)
pnpm validate       # the full CI gate: lint + test + build
pnpm act            # run the CI workflow locally in Docker via nektos/act
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/); a husky `commit-msg` hook enforces this, `pre-commit` runs lint (plus a gitleaks secret scan where installed), and `pre-push` runs the full `pnpm validate` gate. Dependencies are kept current by the shared Arkanis Renovate preset, and CI runs the shared `ArkanisCorporation/ci` Node workflows (lint, test, build).

`pnpm validate` is the universal gate - it reproduces exactly what CI checks, so it works for anyone with a plain `pnpm install`. The shared `ArkanisCorporation/ci` reusable workflows and the `pnpm act` runner are Arkanis-internal conveniences (act needs Docker and access to those private workflows); they are never required to contribute.

## Releases

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) driven by the Conventional Commit history: merging a `feat:`/`fix:` to `main` computes the next version, updates the changelog, tags, cuts a GitHub release, and publishes to npm via [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no long-lived token) with provenance. The pipeline is dormant until the `RELEASE_ENABLED` repository variable is set, so nothing publishes by accident.

## Token sources

Precedence: `--token-cmd` / `--token-env` / `--token-file` / `--token-prompt`, then the profile's `token`, then `$DISCORD_TOKEN`, then a hidden interactive prompt.

There is deliberately no `--token <value>` flag. A token passed that way leaks into shell history and the process list. The config also rejects literal tokens.

## Config

dcsh writes this file for you (`dcsh profile ...`), with mode `600`; editing it by hand works too. The config file lives at `$XDG_CONFIG_HOME/dcsh/config.json` (Windows: `%APPDATA%\dcsh\config.json`). Override the location with `$DCSH_CONFIG_DIR` or `--config`.

```json
{
  "defaultProfile": "arkanis-main",
  "operator": "delta",
  "profiles": {
    "arkanis-main": {
      "token": {
        "command": ["vault", "kv", "get", "-field=token", "secret/arkanis/discord/main-bot"]
      },
      "defaultGuild": "123456789012345678"
    },
    "medrunner-prod": {
      "token": {
        "command": ["vault", "kv", "get", "-field=token", "secret/medrunner/discord/bot"]
      },
      "readOnly": true
    },
    "local-test": { "token": { "file": "~/.secrets/dcsh-test.token" } },
    "adhoc": { "token": { "env": "BOT_TOKEN" } }
  }
}
```

A token source can take four forms:

- `command` as an array runs without a shell, which is the preferred form. As a string it runs through a shell.
- `file` must be mode `600` on Unix.
- `env` names an environment variable to read.
- `prompt: true` asks for the token interactively. It only works at startup, not for an in-shell `profile` switch.

`token` is optional. A profile without one behaves like `prompt: true`: dcsh uses `$DISCORD_TOKEN` if it is set and otherwise asks for the token at startup.

### Credential templates

`dcsh profile add` and the first-run setup build the `token` entry for you:

| Template             | You enter                                        | Stored as                                                                                        |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1Password            | a secret reference `op://<vault>/<item>/<field>` | `{ "command": ["op", "read", "op://..."] }`, with `"--account", "<addr>"` after `op` when scoped |
| Custom command       | a command line that prints the token             | `command` as an array; a string if it uses shell syntax (pipes, quotes, `$VAR`, ...)             |
| Environment variable | a variable name (default `DISCORD_TOKEN`)        | `{ "env": "..." }`                                                                               |
| Token file           | a path                                           | `{ "file": "..." }`                                                                              |
| Ask every time       | nothing                                          | no `token` key                                                                                   |

To get a 1Password secret reference, open the item, use the field's menu and choose **Copy Secret Reference**. The 1Password CLI (`op`) needs to be installed and signed in on the machine that runs dcsh.

The 1Password template also asks for an optional **account** (`my.1password.com`, `<team>.1password.com|.eu|.ca`; `op account list` shows yours). With one set, dcsh runs `op --account <account> read <ref>`. Set it if you have more than one 1Password account. Without it, `op` can resolve the reference against the wrong account. It can also fail outright when the right account is locked, instead of showing the desktop app's unlock prompt.

## Guards

- **Audit log reason required:** every POST/PUT/PATCH/DELETE needs a reason, either session-wide via `reason <text>` or per call via `{ reason }`. It's sent as `[dcsh:<operator>] <reason>`, truncated to 512 chars, so manual fixes are distinguishable from bot behaviour in the audit log.
- **Read-only mode:** set by `readOnly` in the profile or by `--read-only`, it blocks all mutations and can't be switched off in-session. `readonly on` adds the guard ad hoc.
- **No raw client:** only the guarded `api` object is exposed. This protects against mistakes, not against a hostile operator, since anyone holding the token can do anything anyway.

## Known limitations

- **Multi-line pastes after a statement:** statements (`use`, `show ...`) run serialized. A multi-line JS block pasted in the same paste right after a pending statement won't be joined correctly. Typed input is unaffected.
- **History file:** history is stored in `$XDG_STATE_HOME/dcsh/history` (dir mode 700). It contains IDs and reasons but never tokens.
