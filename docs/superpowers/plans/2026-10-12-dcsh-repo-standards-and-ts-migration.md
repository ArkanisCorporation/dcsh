# dcsh repo-standards + TS migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `dcsh` onto the Arkanis Node/TypeScript repo baseline (TS, pnpm, shared Renovate preset, shared CI, lint/format/test, Conventional Commits) with zero change to shell behaviour.

**Architecture:** Mechanical JS→TS port of a ~490-line ESM CLI. One new `src/types.ts` holds the shared shapes (`TokenSource`, `Config`, `Statement`, `GuardedApi`); the three modules and the `bin` entry gain type annotations only. `tsc` compiles to `dist/`; the published `bin` points at `dist/bin/dcsh.js`. Behaviour, command surface, guards, and config format are unchanged — tests pin the existing behaviour before each port.

**Tech Stack:** TypeScript 5.9, Node 24 (engines `>=22`), pnpm, vitest 3, eslint 9 (flat, typescript-eslint), prettier 3, husky 9 + commitlint, Renovate, GitHub Actions (shared `ArkanisCorporation/ci` reusable workflows).

**Spec:** `docs/superpowers/specs/2026-10-09-dcsh-repo-standards-and-ts-migration-design.md`

## Global Constraints

- Node engines `>=22`; CI runs `node-version: 24.x`. (verbatim from spec)
- Package manager is **pnpm**; `package-lock.json` is deleted, `pnpm-lock.yaml` committed.
- ESM throughout (`"type": "module"`); NodeNext module resolution — **import specifiers keep the `.js` extension** (e.g. `import { Session } from '../src/session.js'`), as the existing JS already does.
- **No shell behaviour change**: identical commands, guards, token-source precedence, config format, output. A port task that alters observable behaviour is wrong.
- prettier is the formatting authority (2-space). Do **not** add the central .NET `.editorconfig`; a minimal editor-baseline `.editorconfig` only.
- Renovate preset is exactly `github>ArkanisCorporation/renovate-config`.
- Single PR (no stack). One closing Linear reference on the PR (`Fixes ARK-601`); commits use `Related to ARK-601`.
- Dependency versions below are starting points pinned exact (Renovate keeps them current).

## Review Focus

Input classes / failure modes the spec implies that deserve a pinned test in the owning task:

- **Literal token in config** (`token: "abc"` or missing source key) must be rejected at load, not silently accepted — Task 5 (`loadConfig`).
- **`clean()` on a `Bot `-prefixed or whitespace-containing token** must strip the prefix and reject embedded whitespace/empty — Task 5.
- **Mutation with no reason, or in read-only mode** must throw, never reach the REST client — Task 6 (guard).
- **`parse()` on JS that starts with a keyword** (`show(x)`, `reason.length`, `use = 1`) must return `null` (not intercept as a statement) — Task 7.
- **`use <name>` that is ambiguous** (substring matches >1 guild, no exact) must throw the ambiguity error rather than pick arbitrarily — Task 6.

---

## Task 1: pnpm + package.json + tsconfig scaffolding

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Delete: `package-lock.json`
- Create: `pnpm-lock.yaml` (generated)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm build` → `tsc -b`; `pnpm typecheck` → `tsc --noEmit`; `pnpm test` → `vitest run`; `pnpm lint`, `pnpm format`, `pnpm format:check`. `bin` → `dist/bin/dcsh.js`. These names are relied on by the CI task and every later task's commands.

- [ ] **Step 1: Rewrite `package.json`**

```json
{
  "name": "dcsh",
  "version": "0.1.0",
  "description": "Discord REST shell: a mongosh-style REPL acting as a bot account",
  "type": "module",
  "bin": { "dcsh": "dist/bin/dcsh.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "dev": "tsx bin/dcsh.ts",
    "prepare": "husky",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "@discordjs/rest": "2.6.3",
    "discord-api-types": "0.38.56"
  },
  "devDependencies": {
    "@commitlint/cli": "19.6.1",
    "@commitlint/config-conventional": "19.6.0",
    "@types/node": "24.0.15",
    "eslint": "9.17.0",
    "husky": "9.1.7",
    "prettier": "3.4.2",
    "tsx": "4.20.3",
    "typescript": "5.9.3",
    "typescript-eslint": "8.19.1",
    "vitest": "3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": false,
    "sourceMap": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["bin", "src"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Delete `package-lock.json`; add `dist/` and `node_modules/` to `.gitignore`**

Current `.gitignore` is 13 bytes (likely just `node_modules`). Ensure it contains:

```
node_modules
dist
*.tsbuildinfo
```

- [ ] **Step 4: Install and generate lockfile**

Run: `pnpm install`
Expected: resolves, writes `pnpm-lock.yaml`, no errors. (Source files don't exist as `.ts` yet — that's fine; nothing is built here.)

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json pnpm-lock.yaml .gitignore
git rm package-lock.json
git commit -m "build: switch dcsh to pnpm + TypeScript toolchain

Related to ARK-601"
```

---

## Task 2: prettier + eslint + minimal .editorconfig

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`
- Create: `eslint.config.js`
- Create: `.editorconfig`

**Interfaces:**
- Produces: `pnpm lint` and `pnpm format:check` run clean on the repo as it stands. Later tasks must keep them green.

- [ ] **Step 1: Create `.prettierrc.json`**

```json
{
  "printWidth": 120,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all"
}
```

- [ ] **Step 2: Create `.prettierignore`**

```
dist
pnpm-lock.yaml
```

- [ ] **Step 3: Create `eslint.config.js`** (flat config, type-aware off for baseline speed)

```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

Note: `@eslint/js` ships with `eslint`; add it to devDependencies if the import fails (`pnpm add -D @eslint/js`).

- [ ] **Step 4: Create minimal `.editorconfig`** (NOT the central .NET file — per spec decision 1)

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2
```

- [ ] **Step 5: Verify**

Run: `pnpm format:check`
Expected: may report existing `.js`/`.md` files need formatting. Run `pnpm format` to normalise, then `pnpm format:check` passes. `pnpm lint` has no TS files yet, so eslint passes vacuously.

- [ ] **Step 6: Commit**

```bash
git add .prettierrc.json .prettierignore eslint.config.js .editorconfig
git add -A  # any files prettier reformatted
git commit -m "build: add prettier, eslint flat config, minimal editorconfig

Related to ARK-601"
```

---

## Task 3: vitest config

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Verify**

Run: `pnpm test`
Expected: vitest reports "no test files found" and exits 0 (or run with `--passWithNoTests`; add that flag to the `test` script if vitest fails on no tests: `vitest run --passWithNoTests`).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts package.json
git commit -m "test: add vitest config

Related to ARK-601"
```

---

## Task 4: Shared types module

**Files:**
- Create: `src/types.ts`

**Interfaces:**
- Produces: `TokenSource`, `Profile`, `Config`, `Keyword`, `Statement`, `MutateOptions`, `GuardedApi`. Tasks 5–8 import these.

- [ ] **Step 1: Create `src/types.ts`**

```ts
/** A profile/flag specifies the bot token through exactly one of these four shapes. */
export type TokenSource =
  | { command: string | string[] }
  | { env: string }
  | { file: string }
  | { prompt: true };

/** One configured bot profile from the config file. */
export interface Profile {
  token?: TokenSource;
  defaultGuild?: string;
  readOnly?: boolean;
}

/** The parsed config file, plus the resolved `path` it was loaded from. */
export interface Config {
  path: string;
  defaultProfile?: string;
  operator?: string;
  profiles: Record<string, Profile>;
}

/** Shell statement keywords (as opposed to raw JavaScript lines). */
export type Keyword = 'show' | 'use' | 'profile' | 'reason' | 'readonly' | 'whoami' | 'help';

/** A line parsed as a shell statement: a keyword and its (possibly empty) argument. */
export interface Statement {
  cmd: Keyword;
  arg: string;
}

/** Options accepted by a guarded mutating request. `reason` drives the audit-log entry. */
export interface MutateOptions {
  reason?: string;
  body?: unknown;
  query?: URLSearchParams;
  [key: string]: unknown;
}

/** The guarded REST surface exposed in the REPL: GETs pass through, mutations are checked. */
export interface GuardedApi {
  get(route: string, opts?: { query?: URLSearchParams }): Promise<unknown>;
  post(route: string, opts?: MutateOptions): Promise<unknown>;
  put(route: string, opts?: MutateOptions): Promise<unknown>;
  patch(route: string, opts?: MutateOptions): Promise<unknown>;
  delete(route: string, opts?: MutateOptions): Promise<unknown>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no other `.ts` yet).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript types for dcsh

Related to ARK-601"
```

---

## Task 5: Port `src/config.ts` (+ tests)

The existing `src/config.js` logic is correct and stays byte-for-byte except for added type annotations and imports. Tests are written first to pin behaviour, then the file is renamed `.js`→`.ts` and annotated.

**Files:**
- Create: `tests/config.test.ts`
- Rename+modify: `src/config.js` → `src/config.ts`

**Interfaces:**
- Consumes: `TokenSource`, `Config`, `Profile` from `./types.js`.
- Produces: `configDir(): string`, `stateDir(): string`, `loadConfig(path?: string): Config`, `pickTokenSource(flags: Record<string, unknown>, profile?: Profile | null): TokenSource`, `describeSource(src: TokenSource): string`, `resolveToken(src: TokenSource, opts?: { allowPrompt?: boolean }): Promise<string>`.

- [ ] **Step 1: Write failing tests** `tests/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, pickTokenSource, describeSource, resolveToken } from '../src/config.js';

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dcsh-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe('loadConfig', () => {
  it('rejects a literal (string) token', () => {
    const p = writeConfig({ profiles: { a: { token: 'abc' } } });
    expect(() => loadConfig(p)).toThrow(/Literal tokens are not supported|needs token/);
  });

  it('rejects a profile whose token has no known source key', () => {
    const p = writeConfig({ profiles: { a: { token: { nope: 1 } } } });
    expect(() => loadConfig(p)).toThrow(/needs token/);
  });

  it('accepts each valid source shape', () => {
    const p = writeConfig({
      profiles: {
        c: { token: { command: ['x'] } },
        e: { token: { env: 'T' } },
        f: { token: { file: '/t' } },
        pr: { token: { prompt: true } },
      },
    });
    expect(Object.keys(loadConfig(p).profiles)).toHaveLength(4);
  });

  it('returns empty profiles when the file is absent', () => {
    expect(loadConfig('/does/not/exist.json').profiles).toEqual({});
  });
});

describe('pickTokenSource precedence', () => {
  it('flag beats profile beats env', () => {
    expect(pickTokenSource({ 'token-env': 'FOO' }, { token: { env: 'BAR' } })).toEqual({ env: 'FOO' });
    expect(pickTokenSource({}, { token: { env: 'BAR' } })).toEqual({ token: { env: 'BAR' } }.token);
  });

  it('falls back to $DISCORD_TOKEN then prompt', () => {
    const prev = process.env.DISCORD_TOKEN;
    process.env.DISCORD_TOKEN = 'x';
    expect(pickTokenSource({}, null)).toEqual({ env: 'DISCORD_TOKEN' });
    delete process.env.DISCORD_TOKEN;
    expect(pickTokenSource({}, null)).toEqual({ prompt: true });
    if (prev !== undefined) process.env.DISCORD_TOKEN = prev;
  });
});

describe('describeSource', () => {
  it('names each source without leaking values', () => {
    expect(describeSource({ env: 'T' })).toBe('env $T');
    expect(describeSource({ file: '/t' })).toBe('file /t');
    expect(describeSource({ prompt: true })).toBe('interactive prompt');
    expect(describeSource({ command: ['vault', 'kv'] })).toMatch(/^command \(vault/);
  });
});

describe('resolveToken clean()', () => {
  it('strips a leading "Bot " prefix from an env token', async () => {
    process.env.DCSH_TEST_TOKEN = 'Bot abc.def';
    await expect(resolveToken({ env: 'DCSH_TEST_TOKEN' })).resolves.toBe('abc.def');
    delete process.env.DCSH_TEST_TOKEN;
  });

  it('rejects a token containing whitespace', async () => {
    process.env.DCSH_TEST_TOKEN = 'a b c';
    await expect(resolveToken({ env: 'DCSH_TEST_TOKEN' })).rejects.toThrow(/empty or malformed/);
    delete process.env.DCSH_TEST_TOKEN;
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test`
Expected: FAIL — `../src/config.js` cannot be resolved (only `config.js` the plain-JS file exists and will once renamed; at this point the `.ts` does not).

- [ ] **Step 3: Rename `src/config.js` → `src/config.ts` and annotate**

Keep every function body identical to the JS original. Apply only these type changes:

- `import type { TokenSource, Config, Profile } from './types.js';`
- `export function configDir(): string`, `export function stateDir(): string`.
- `export function loadConfig(path?: string): Config` — annotate the loop `for (const [name, prof] of Object.entries<Profile>(profiles))`; the returned object is `Config`.
- `export function pickTokenSource(flags: Record<string, unknown>, profile?: Profile | null): TokenSource`.
- `export function describeSource(src: TokenSource): string` — inside, narrow with `'command' in src` etc. (the union has no shared `.command`), e.g.:

```ts
export function describeSource(src: TokenSource): string {
  if ('command' in src) return `command (${Array.isArray(src.command) ? src.command[0] : src.command.split(' ')[0]} ...)`;
  if ('env' in src) return `env $${src.env}`;
  if ('file' in src) return `file ${src.file}`;
  return 'interactive prompt';
}
```

- `export async function resolveToken(src: TokenSource, { allowPrompt = true }: { allowPrompt?: boolean } = {}): Promise<string>` — narrow each branch with `'command' in src` / `'env' in src` / `'file' in src` / `'prompt' in src`.
- `function clean(value: string, from: string): string`.
- `function promptHidden(question: string): Promise<string>` — the `rl._writeToOutput` assignment needs `// @ts-expect-error private readline internal` above it.

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/config.test.ts
git add -A src/config.ts
git rm src/config.js
git commit -m "refactor: port config module to TypeScript

Related to ARK-601"
```

---

## Task 6: Port `src/session.ts` (+ guard tests)

**Files:**
- Create: `tests/session.test.ts`
- Rename+modify: `src/session.js` → `src/session.ts`

**Interfaces:**
- Consumes: `GuardedApi`, `MutateOptions` from `./types.js`.
- Produces: `class Session` with `operator: string`, `profile: string | null`, `me`, `guild`, `guildCache`, `reason: string | null`, `readOnly: boolean`; methods `connect`, `setReadOnly(on: boolean)`, `get api(): GuardedApi`, `listGuilds`, `use(ref: string)`, `requireGuild()`.

- [ ] **Step 1: Write failing tests** `tests/session.test.ts`

Mock `@discordjs/rest` so no network is touched; assert the guard, not the wire.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ method: string; route: string; opts: unknown }> = [];
vi.mock('@discordjs/rest', () => {
  class REST {
    setToken() { return this; }
    get(route: string, opts: unknown) {
      if (route.endsWith('/@me')) return Promise.resolve({ id: '1', username: 'bot', bot: true });
      calls.push({ method: 'get', route, opts });
      return Promise.resolve([]);
    }
    post(route: string, opts: unknown) { calls.push({ method: 'post', route, opts }); return Promise.resolve({}); }
    delete(route: string, opts: unknown) { calls.push({ method: 'delete', route, opts }); return Promise.resolve({}); }
  }
  return { REST };
});

const { Session } = await import('../src/session.js');
const { Routes } = await import('discord-api-types/v10');

describe('mutation guard', () => {
  beforeEach(() => { calls.length = 0; });

  it('blocks mutations in read-only mode, never reaching REST', async () => {
    const s = new Session({ operator: 'delta' });
    await s.connect('t', { readOnly: true });
    expect(() => s.api.delete(Routes.channel('1'))).toThrow(/read-only/);
    expect(calls).toHaveLength(0);
  });

  it('requires a reason for a mutation', async () => {
    const s = new Session({ operator: 'delta' });
    await s.connect('t', {});
    expect(() => s.api.delete(Routes.channel('1'))).toThrow(/reason/);
  });

  it('formats and truncates the audit reason to 512 chars', async () => {
    const s = new Session({ operator: 'delta' });
    await s.connect('t', {});
    s.reason = 'x'.repeat(600);
    await s.api.delete(Routes.channel('1'));
    const sent = calls.find((c) => c.method === 'delete')!.opts as { reason: string };
    expect(sent.reason.startsWith('[dcsh:delta] ')).toBe(true);
    expect(sent.reason.length).toBe(512);
  });

  it('throws on an ambiguous `use <name>` (substring matches >1 guild, no exact)', async () => {
    const s = new Session({ operator: 'delta' });
    await s.connect('t', {});
    // Seed the cache so use() resolves names offline (listGuilds returns the cache when not refreshing).
    s.guildCache = [
      { id: '10', name: 'Arkanis Main' },
      { id: '11', name: 'Arkanis Test' },
    ] as never;
    await expect(s.use('arkanis')).rejects.toThrow(/ambiguous/);
  });

  it('refuses a non-bot token', async () => {
    const s = new Session({ operator: 'delta' });
    // override @me to a user account for this test
    const rest = await import('@discordjs/rest');
    vi.spyOn(rest.REST.prototype, 'get').mockResolvedValueOnce({ id: '1', username: 'u', bot: false } as never);
    await expect(s.connect('t', {})).rejects.toThrow(/not a bot token/);
  });
});
```

- [ ] **Step 2: Run, verify fail** — Run: `pnpm test`; Expected: FAIL (`../src/session.js` unresolved).

- [ ] **Step 3: Rename `src/session.js` → `src/session.ts` and annotate**

Bodies unchanged. Type changes:

- `import { REST } from '@discordjs/rest';` stays; `import { Routes } from 'discord-api-types/v10';` stays.
- Import result types: `import type { RESTGetAPICurrentUserResult, RESTGetAPICurrentUserGuildsResult, RESTGetAPIGuildResult } from 'discord-api-types/v10';` and `GuardedApi`, `MutateOptions` from `./types.js`.
- Private fields: `#rest: REST | null = null;` `#hardReadOnly = false;`.
- Constructor param `{ operator }: { operator: string }`; annotate the assigned fields (`profile: string | null`, `me: RESTGetAPICurrentUserResult | null`, `guild: RESTGetAPIGuildResult | null`, `guildCache: RESTGetAPICurrentUserGuildsResult | null`, `reason: string | null`, `readOnly: boolean`).
- `connect(token: string, { profile = null, readOnly = false }: { profile?: string | null; readOnly?: boolean } = {})` — `me` from `rest.get(...)` needs a cast: `const me = (await rest.get(Routes.user('@me'))) as RESTGetAPICurrentUserResult;`.
- `setReadOnly(on: boolean)`.
- `get api(): GuardedApi` — type the local `api` as `GuardedApi`; the mutation closure param `(route: string, opts: MutateOptions = {})`; index with `rest[method as 'post' | 'put' | 'patch' | 'delete']`.
- `listGuilds({ refresh = false }: { refresh?: boolean } = {})` — cast each page `as RESTGetAPICurrentUserGuildsResult`.
- `use(ref: string)` — cast guild gets `as RESTGetAPIGuildResult`.
- `requireGuild(): RESTGetAPIGuildResult`.

- [ ] **Step 4: Run tests + typecheck** — Run: `pnpm test && pnpm typecheck`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/session.test.ts
git add -A src/session.ts
git rm src/session.js
git commit -m "refactor: port session module to TypeScript

Related to ARK-601"
```

---

## Task 7: Port `src/commands.ts` (+ parse tests)

**Files:**
- Create: `tests/commands.test.ts`
- Rename+modify: `src/commands.js` → `src/commands.ts`

**Interfaces:**
- Consumes: `Statement`, `Keyword`, `Config` from `./types.js`; `Session` from `./session.js`.
- Produces: `KEYWORDS: readonly Keyword[]`, `SHOW_TARGETS: readonly string[]`, `parse(line: string): Statement | null`, `dispatch(stmt: Statement, ctx: { session: Session; config: Config; switchProfile: (name: string) => Promise<void> }): Promise<unknown>`.

- [ ] **Step 1: Write failing tests** `tests/commands.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parse } from '../src/commands.js';

describe('parse', () => {
  it('parses statements', () => {
    expect(parse('show servers')).toEqual({ cmd: 'show', arg: 'servers' });
    expect(parse('use Arkanis')).toEqual({ cmd: 'use', arg: 'Arkanis' });
    expect(parse('help')).toEqual({ cmd: 'help', arg: '' });
  });

  it('does NOT intercept JavaScript that starts with a keyword', () => {
    expect(parse('show(x)')).toBeNull();
    expect(parse('reason.length')).toBeNull();
    expect(parse('use = 1')).toBeNull();
  });

  it('returns null for non-keywords', () => {
    expect(parse('await api.get(x)')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — Run: `pnpm test`; Expected: FAIL (`../src/commands.js` unresolved).

- [ ] **Step 3: Rename `src/commands.js` → `src/commands.ts` and annotate**

Bodies unchanged. Type changes:

- `import { Routes, ChannelType } from 'discord-api-types/v10';` stays.
- `import type { Statement, Keyword, Config } from './types.js';` and `import type { Session } from './session.js';`.
- `export const KEYWORDS: readonly Keyword[] = ['show', 'use', 'profile', 'reason', 'readonly', 'whoami', 'help'];`
- `export const SHOW_TARGETS = ['servers', 'channels', 'roles', 'members', 'profiles', 'context'] as const;`
- `export function parse(line: string): Statement | null` — the regex match cast: return `{ cmd: m[1] as Keyword, arg: (m[2] ?? '').trim() }`.
- `export async function dispatch({ cmd, arg }: Statement, { session, config, switchProfile }: { session: Session; config: Config; switchProfile: (name: string) => Promise<void> }): Promise<unknown>`.
- `async function show(arg: string, session: Session, config: Config)`; the REST results used for `console.table` are cast to the relevant `RESTGetAPIGuild*Result` types (or `any[]` locally with an inline comment if the row-mapping types get noisy — prefer the real types). `function sortKey(c, byId)` and `function showContext(s: Session)` annotated.

- [ ] **Step 4: Run tests + typecheck** — Run: `pnpm test && pnpm typecheck`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/commands.test.ts
git add -A src/commands.ts
git rm src/commands.js
git commit -m "refactor: port commands module to TypeScript

Related to ARK-601"
```

---

## Task 8: Port `bin/dcsh.ts` + build smoke check

**Files:**
- Rename+modify: `bin/dcsh.js` → `bin/dcsh.ts`

**Interfaces:**
- Consumes: everything from `../src/config.js`, `../src/session.js`, `../src/commands.js` (now `.ts`, imported with `.js` specifiers).

- [ ] **Step 1: Rename `bin/dcsh.js` → `bin/dcsh.ts` and annotate**

Keep the shebang line `#!/usr/bin/env node` as line 1 (tsc preserves it). Bodies unchanged. Type changes:

- `const fail = (err: unknown): never => { console.error(\`dcsh: ${formatError(err)}\`); process.exit(1); };`
- `async function activate(profileName: string | undefined, { atStartup }: { atStartup: boolean })`.
- `function installContext(ctx: Record<string, unknown>)` — the `ro` helper `(name: string, get: () => unknown)`.
- `server.eval` reassignment: the callback params `(code: string, context: unknown, file: string, cb: (err: Error | null, result?: unknown) => void)`.
- `server.completer` reassignment: `(line: string, cb: (err: Error | null, result: [string[], string]) => void)`.
- `function formatError(err: any): string` (the `err?.rawError` / `err?.status` shape is a discord REST error; `any` with an inline comment is acceptable here, or a small local interface).
- `parseArgs` generic typing stays inferred.

- [ ] **Step 2: Build and smoke-test the compiled binary**

Run: `pnpm build && node dist/bin/dcsh.js --help`
Expected: PASS — prints the USAGE block, exits 0. (`--help` touches no token/network path.)

- [ ] **Step 3: Full verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add -A bin/dcsh.ts
git rm bin/dcsh.js
git commit -m "refactor: port bin entry to TypeScript

Related to ARK-601"
```

---

## Task 9: husky + commitlint (Conventional Commits)

**Files:**
- Create: `.husky/commit-msg`
- Create: `commitlint.config.js`

- [ ] **Step 1: Initialise husky**

Run: `pnpm exec husky init` (creates `.husky/` and the `prepare` script already points at `husky`). Remove the sample `.husky/pre-commit` if it only contains `pnpm test` placeholder, or keep a `pre-commit` running `pnpm lint` (decide: keep `pre-commit` → `pnpm lint && pnpm test`).

- [ ] **Step 2: Create `commitlint.config.js`**

```js
export default { extends: ['@commitlint/config-conventional'] };
```

- [ ] **Step 3: Create `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

- [ ] **Step 4: Verify the hook rejects a bad message and accepts a good one**

Run: `echo "nonsense message" | pnpm exec commitlint`
Expected: FAIL (non-conventional). Then `echo "feat: x" | pnpm exec commitlint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add .husky/commit-msg commitlint.config.js package.json
git commit -m "build: enforce Conventional Commits with husky + commitlint

Related to ARK-601"
```

---

## Task 10: Renovate + .gitattributes

**Files:**
- Create: `renovate.json5`
- Create: `.gitattributes`

- [ ] **Step 1: Create `renovate.json5`**

```json5
{
  $schema: 'https://docs.renovatebot.com/renovate-schema.json',
  extends: ['github>ArkanisCorporation/renovate-config'],
}
```

- [ ] **Step 2: Create `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
pnpm-lock.yaml linguist-generated=true -diff
```

- [ ] **Step 3: Commit**

```bash
git add renovate.json5 .gitattributes
git commit -m "ci: adopt shared Renovate preset and add .gitattributes

Related to ARK-601"
```

---

## Task 11: GitHub Actions CI

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: the `pnpm lint` / `test` / `build` scripts from Task 1. The shared reusable workflows invoke the package manager's lint/test/build.

- [ ] **Step 1: Create `.github/workflows/build.yml`** (modelled on `ci/examples/node-pnpm`)

```yaml
name: build

on:
  pull_request:
  push:
    branches: [main]

permissions: {}

jobs:
  node-lint:
    name: lint @ ${{ github.head_ref || github.ref_name }}
    uses: ArkanisCorporation/ci/.github/workflows/wf-node-lint.yml@v1
    permissions:
      contents: read
    with:
      runs-on: ubuntu-latest
      runs-on-self-hosted: false
      node-version: 24.x
      package-manager: pnpm
      package-manager-version: "10"
      working-directory: .
      enable-cache: true

  node-test:
    name: test @ ${{ github.head_ref || github.ref_name }}
    uses: ArkanisCorporation/ci/.github/workflows/wf-node-test.yml@v1
    permissions:
      contents: read
    with:
      runs-on: ubuntu-latest
      runs-on-self-hosted: false
      node-version: 24.x
      package-manager: pnpm
      package-manager-version: "10"
      working-directory: .
      enable-cache: true

  node-build:
    name: build @ ${{ github.head_ref || github.ref_name }}
    uses: ArkanisCorporation/ci/.github/workflows/wf-node-build.yml@v1
    permissions:
      contents: read
    with:
      runs-on: ubuntu-latest
      runs-on-self-hosted: false
      node-version: 24.x
      package-manager: pnpm
      package-manager-version: "10"
      working-directory: .
      enable-cache: true

  actions-lint:
    name: lint github actions
    uses: ArkanisCorporation/ci/.github/workflows/wf-lint-github-actions.yml@v1
    permissions:
      contents: read
```

Note: confirm each reusable workflow's exact inputs against `ci/schemas/workflow-inputs/*.schema.json` during implementation; `wf-lint-github-actions` may take no `with:` block. Adjust to match the schemas rather than guessing.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add build workflow using shared Arkanis Node workflows

Related to ARK-601"
```

---

## Task 12: Docs refresh

**Files:**
- Modify: `README.md`
- Create or modify: `AGENTS.md`

- [ ] **Step 1: Update `README.md` install block**

Replace the `npm install && npm link` quickstart with the pnpm + build flow:

```
pnpm install && pnpm build && pnpm link --global   # Node >= 22
dcsh -p arkanis-main
```

Add a short "Development" section: `pnpm dev` (runs via tsx), `pnpm test`, `pnpm lint`, `pnpm build`.

- [ ] **Step 2: Create `AGENTS.md`** documenting the toolchain for future agents: pnpm, `tsc` build to `dist/`, vitest, eslint+prettier, Conventional Commits enforced by husky, shared CI + Renovate. Keep it short; point at the spec for rationale.

- [ ] **Step 3: Final full verify**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build && node dist/bin/dcsh.js --help`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document pnpm/TypeScript toolchain

Related to ARK-601"
```

---

## Wrap-up

- [ ] Push the branch and open **one PR** (`## Overview / ## Description / ## Details` template), body ending in the single closing reference `Fixes ARK-601` and the Claude Code attribution line. The PR introduces the CI structure → include the captioned+collapsed CI mermaid from the spec.
- [ ] Confirm all four CI jobs pass on the PR before requesting review.
- [ ] Flipping the repo public and any npm publish are deliberately out of scope (follow-up once CI is green).
