import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, pickTokenSource, describeSource, resolveToken } from '../src/config.js';

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dcsh-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe('loadConfig', () => {
  it('rejects a literal (string) token', () => {
    const p = writeConfig({ profiles: { a: { token: 'abc' } } });
    expect(() => loadConfig(p)).toThrow(/Literal tokens are not supported/);
  });

  it('rejects a profile whose token has no known source key', () => {
    const p = writeConfig({ profiles: { a: { token: { nope: 1 } } } });
    expect(() => loadConfig(p)).toThrow(/token must be/);
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

  it('accepts a profile without a token (prompted at startup)', () => {
    const p = writeConfig({ profiles: { a: { defaultGuild: '1' } } });
    expect(loadConfig(p).profiles.a).toEqual({ defaultGuild: '1' });
  });

  it('returns empty profiles when the file is absent', () => {
    expect(loadConfig('/does/not/exist.json').profiles).toEqual({});
  });
});

describe('saveConfig', () => {
  it('round-trips, drops the path key, keeps unknown keys, writes mode 600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcsh-'));
    const path = join(dir, 'nested', 'config.json');
    saveConfig({ path, operator: 'me', extra: 1, profiles: { a: { token: { env: 'T' } } } } as never);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw).toEqual({ operator: 'me', extra: 1, profiles: { a: { token: { env: 'T' } } } });
    expect(loadConfig(path).profiles.a).toEqual({ token: { env: 'T' } });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('pickTokenSource precedence', () => {
  it('flag beats profile beats env', () => {
    expect(pickTokenSource({ 'token-env': 'FOO' }, { token: { env: 'BAR' } })).toEqual({ env: 'FOO' });
    expect(pickTokenSource({}, { token: { env: 'BAR' } })).toEqual({ env: 'BAR' });
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

  it('rejects a whitespace-only token (empty after trim)', async () => {
    process.env.DCSH_TEST_TOKEN = '   ';
    await expect(resolveToken({ env: 'DCSH_TEST_TOKEN' })).rejects.toThrow(/empty or malformed/);
    delete process.env.DCSH_TEST_TOKEN;
  });
});
