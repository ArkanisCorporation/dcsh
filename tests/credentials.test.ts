import { describe, it, expect } from 'vitest';
import {
  OP_REFERENCE,
  onePasswordSource,
  onePasswordReference,
  commandSource,
  commandLine,
  detectTemplate,
  describeCredential,
} from '../src/credentials.js';

describe('1Password references', () => {
  it('accepts vault/item/field and vault/item/section/field', () => {
    expect(OP_REFERENCE.test('op://abc123/def456/credential')).toBe(true);
    expect(OP_REFERENCE.test('op://Infra/Discord Bot/token')).toBe(false); // whitespace
    expect(OP_REFERENCE.test('op://Infra/bot/section/token')).toBe(true);
    expect(OP_REFERENCE.test('op://Infra/bot')).toBe(false);
    expect(OP_REFERENCE.test('vault/item/field')).toBe(false);
  });

  it('stores `op read <ref>` as argv and recognises it again', () => {
    const src = onePasswordSource('op://v/i/f');
    expect(src).toEqual({ command: ['op', 'read', 'op://v/i/f'] });
    expect(onePasswordReference(src)).toBe('op://v/i/f');
    expect(detectTemplate(src)).toBe('1password');
  });

  it('does not mistake other op invocations for the template', () => {
    expect(detectTemplate({ command: ['op', 'read', 'op://v/i/f', '--no-newline'] })).toBe('command');
    expect(detectTemplate({ command: 'op read op://v/i/f' })).toBe('command');
  });
});

describe('commandSource', () => {
  it('uses argv (no shell) for plain words', () => {
    expect(commandSource('  vault kv get -field=token secret/bot ')).toEqual({
      command: ['vault', 'kv', 'get', '-field=token', 'secret/bot'],
    });
  });

  it('keeps the shell string when the line uses shell syntax', () => {
    expect(commandSource('pass show bot | head -1')).toEqual({ command: 'pass show bot | head -1' });
    expect(commandSource("secret-tool lookup app 'my bot'")).toEqual({ command: "secret-tool lookup app 'my bot'" });
    expect(commandSource('cat $HOME/t')).toEqual({ command: 'cat $HOME/t' });
  });

  it('rejects an empty command and round-trips through commandLine', () => {
    expect(() => commandSource('   ')).toThrow(/empty/);
    expect(commandLine({ command: ['a', 'b'] })).toBe('a b');
  });
});

describe('detectTemplate / describeCredential', () => {
  it('maps every source shape, missing token = ask every time', () => {
    expect(detectTemplate(undefined)).toBe('prompt');
    expect(detectTemplate({ prompt: true })).toBe('prompt');
    expect(detectTemplate({ env: 'T' })).toBe('env');
    expect(detectTemplate({ file: '/t' })).toBe('file');
    expect(detectTemplate({ command: ['vault'] })).toBe('command');
  });

  it('never shows command arguments', () => {
    expect(describeCredential({ command: ['echo', 'secret'] })).not.toMatch(/secret/);
    expect(describeCredential(undefined)).toBe('ask every time');
    expect(describeCredential(onePasswordSource('op://v/i/f'))).toBe('1Password op://v/i/f');
  });
});
