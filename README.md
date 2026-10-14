# dcsh: Discord REST shell

A mongosh-style REPL that acts as a bot account over the Discord REST API (v10). It never connects to the gateway, so it can't interfere with the running bot's session. It does share that bot's rate-limit buckets.

```
pnpm install && pnpm build && pnpm link --global   # Node >= 22
dcsh -p arkanis-main
arkanis-main> show servers
arkanis-main> use Arkanis
arkanis-main/Arkanis> show channels squad
arkanis-main/Arkanis> reason orphaned VC after sync bug
arkanis-main/Arkanis> await api.delete(Routes.channel('1234567890123456789'))
```

Type `help` in the shell for the full statement list.

## Development

dcsh is written in TypeScript (ESM) and built with `tsc` to `dist/`; the `dcsh` bin runs the compiled output.

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

To reproduce CI exactly before pushing, `pnpm act` runs the `build` workflow in containers via [nektos/act](https://github.com/nektos/act). It needs Docker running and the [gh CLI](https://cli.github.com/) authenticated (or `GITHUB_TOKEN` set) so act can fetch the private `ArkanisCorporation/ci` reusable workflows; the pinned act binary is fetched and checksum-verified into `.act/` on first use.

## Token sources

Precedence: `--token-cmd` / `--token-env` / `--token-file` / `--token-prompt`, then the profile's `token`, then `$DISCORD_TOKEN`, then a hidden interactive prompt.

There is deliberately no `--token <value>` flag. A token passed that way leaks into shell history and the process list. The config also rejects literal tokens.

## Config

The config file lives at `$XDG_CONFIG_HOME/dcsh/config.json` (Windows: `%APPDATA%\dcsh\config.json`). Override the location with `$DCSH_CONFIG_DIR` or `--config`.

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

## Guards

- **Audit log reason required:** every POST/PUT/PATCH/DELETE needs a reason, either session-wide via `reason <text>` or per call via `{ reason }`. It's sent as `[dcsh:<operator>] <reason>`, truncated to 512 chars, so manual fixes are distinguishable from bot behaviour in the audit log.
- **Read-only mode:** set by `readOnly` in the profile or by `--read-only`, it blocks all mutations and can't be switched off in-session. `readonly on` adds the guard ad hoc.
- **No raw client:** only the guarded `api` object is exposed. This protects against mistakes, not against a hostile operator, since anyone holding the token can do anything anyway.

## Known limitations

- **Multi-line pastes after a statement:** statements (`use`, `show ...`) run serialized. A multi-line JS block pasted in the same paste right after a pending statement won't be joined correctly. Typed input is unaffected.
- **History file:** history is stored in `$XDG_STATE_HOME/dcsh/history` (dir mode 700). It contains IDs and reasons but never tokens.
