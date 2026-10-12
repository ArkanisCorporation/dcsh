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
});
