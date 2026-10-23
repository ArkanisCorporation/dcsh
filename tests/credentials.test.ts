import { describe, it, expect } from 'vitest';
import {
  OP_REFERENCE,
  OP_ACCOUNT,
  normalizeOpAccount,
  looksLikeToken,
  onePasswordSource,
  parseOnePassword,
  commandSource,
  commandLine,
  detectTemplate,
  describeCredential,
} from '../src/credentials.js';

describe('1Password references', () => {
  it('accepts vault/item/field and vault/item/section/field', () => {
    expect(OP_REFERENCE.test('op://abc123/def456/credential')).toBe(true);
    expect(OP_REFERENCE.test('op://Shared Vault/Discord Bot/token')).toBe(true); // names with spaces
    expect(OP_REFERENCE.test('op://v/ /token')).toBe(false); // blank segment
    expect(OP_REFERENCE.test('op://v/i/f\nrm')).toBe(false);
    expect(OP_REFERENCE.test('op://Infra/bot/section/token')).toBe(true);
    expect(OP_REFERENCE.test('op://Infra/bot')).toBe(false);
    expect(OP_REFERENCE.test('vault/item/field')).toBe(false);
  });

  it('stores `op read <ref>` as argv and recognises it again', () => {
    const src = onePasswordSource('op://v/i/f');
    expect(src).toEqual({ command: ['op', 'read', 'op://v/i/f'] });
    expect(parseOnePassword(src)).toEqual({ reference: 'op://v/i/f' });
    expect(detectTemplate(src)).toBe('1password');
  });

  it('scopes to an account with `op --account <addr> read <ref>`', () => {
    const src = onePasswordSource('op://v/i/f', 'acme.1password.eu');
    expect(src).toEqual({ command: ['op', '--account', 'acme.1password.eu', 'read', 'op://v/i/f'] });
    expect(parseOnePassword(src)).toEqual({ reference: 'op://v/i/f', account: 'acme.1password.eu' });
    expect(describeCredential(src)).toBe('1Password op://v/i/f (acme.1password.eu)');
  });

  it('validates and normalises account sign-in addresses', () => {
    for (const ok of ['my.1password.com', 'acme.1password.eu', 'acme-corp.1password.ca'])
      expect(OP_ACCOUNT.test(ok)).toBe(true);
    for (const bad of ['1password.com', 'acme.1password.de', 'acme.example.com', 'a b.1password.com'])
      expect(OP_ACCOUNT.test(bad)).toBe(false);
    expect(normalizeOpAccount(' https://ACME.1password.com/signin ')).toBe('acme.1password.com');
  });

  it('does not mistake other op invocations for the template', () => {
    expect(detectTemplate({ command: ['op', 'read', 'op://v/i/f', '--no-newline'] })).toBe('command');
    expect(detectTemplate({ command: 'op read op://v/i/f' })).toBe('command');
    expect(detectTemplate({ command: ['op', '--account', 'nope', 'read', 'op://v/i/f'] })).toBe('command');
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

  it('uses the shell for env assignments, cmd.exe variables, and always on Windows', () => {
    expect(commandSource('VAULT_ADDR=x vault kv get t')).toEqual({ command: 'VAULT_ADDR=x vault kv get t' });
    expect(commandSource('type %USERPROFILE%\\t')).toHaveProperty('command', 'type %USERPROFILE%\\t');
    expect(commandSource('vault kv get t', 'win32')).toEqual({ command: 'vault kv get t' });
    expect(commandSource('vault kv get -field=token t')).toHaveProperty('command.length', 5);
  });

  it('rejects an empty command and round-trips through commandLine', () => {
    expect(() => commandSource('   ')).toThrow(/empty/);
    expect(commandLine({ command: ['a', 'b'] })).toBe('a b');
    // an argv entry with a space survives edit-and-save as one argument (via the shell form)
    expect(commandLine({ command: ['secret-tool', 'lookup', 'my bot'] })).toBe("secret-tool lookup 'my bot'");
    expect(commandSource(commandLine({ command: ['x', 'my bot'] }))).toEqual({ command: "x 'my bot'" });
  });

  it('recognises a pasted bot token', () => {
    // Assembled at runtime so secret scanners don't flag a token-shaped literal in the repo.
    expect(looksLikeToken(['x'.repeat(26), 'y'.repeat(6), 'z'.repeat(30)].join('.'))).toBe(true);
    expect(looksLikeToken('vault kv get -field=token secret/bot')).toBe(false);
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
