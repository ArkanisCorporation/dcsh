import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  profileWizard,
  applyProfile,
  removeProfile,
  profileRows,
  runProfileCommand,
  runOnboarding,
  type Prompts,
  type Verified,
} from '../src/profiles.js';
import type { Config } from '../src/types.js';

/**
 * Scripted prompts: answers are consumed in order. `undefined` means "accept the default", and
 * every answer is run through the prompt's validator so the tests also exercise validation.
 */
function scripted(answers: unknown[]): Prompts & { asked: string[] } {
  const asked: string[] = [];
  const next = (message: string, dflt: unknown) => {
    asked.push(message);
    if (answers.length === 0) throw new Error(`unexpected prompt: ${message}`);
    const a = answers.shift();
    return a === undefined ? dflt : a;
  };
  return {
    asked,
    input: async (o) => {
      const v = next(o.message, o.default ?? '') as string;
      const ok = o.validate?.(v) ?? true;
      if (ok !== true) throw new Error(`invalid answer for "${o.message}": ${ok}`);
      return v;
    },
    select: async <T>(o: { message: string; default?: T }) => next(o.message, o.default) as T,
    confirm: async (o) => next(o.message, o.default ?? false) as boolean,
  };
}

const quiet = () => {};
const empty = (): Config => ({ path: '/x/config.json', profiles: {} });
const okVerify = async (): Promise<Verified> => ({ username: 'bot', guilds: [{ id: '111', name: 'Arkanis' }] });

describe('profileWizard', () => {
  it('first profile: 1Password + verified server picker, becomes default without asking', async () => {
    const prompts = scripted([undefined, '1password', 'op://vault/item/token', true, '111', false]);
    const r = await profileWizard(empty(), undefined, { prompts, verify: okVerify, log: quiet });
    expect(r).toEqual({
      name: 'default',
      profile: { token: { command: ['op', 'read', 'op://vault/item/token'] }, defaultGuild: '111' },
      makeDefault: true,
    });
    expect(prompts.asked).not.toContain('Make this the default profile?');
  });

  it('custom command, unverified, free-text server, read-only', async () => {
    const cfg: Config = { ...empty(), defaultProfile: 'a', profiles: { a: {} } };
    const prompts = scripted([
      'prod',
      'command',
      'vault kv get -field=token secret/bot',
      false,
      'Arkanis',
      true,
      false,
    ]);
    const r = await profileWizard(cfg, undefined, { prompts, verify: okVerify, log: quiet });
    expect(r.profile).toEqual({
      token: { command: ['vault', 'kv', 'get', '-field=token', 'secret/bot'] },
      defaultGuild: 'Arkanis',
      readOnly: true,
    });
    expect(r.makeDefault).toBe(false);
  });

  it('"ask every time" stores no token and a failed check still saves', async () => {
    const logs: string[] = [];
    const prompts = scripted([undefined, 'prompt', true, '', false]);
    const r = await profileWizard(empty(), undefined, {
      prompts,
      verify: async () => {
        throw new Error('401: Unauthorized');
      },
      log: (l) => logs.push(l),
    });
    expect(r.profile).toEqual({});
    expect(logs.join('\n')).toMatch(/check failed: 401/);
  });

  it('rejects duplicate names and malformed op:// references', async () => {
    const cfg: Config = { ...empty(), profiles: { taken: {} } };
    await expect(profileWizard(cfg, undefined, { prompts: scripted(['taken']), log: quiet })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      profileWizard(empty(), undefined, { prompts: scripted(['x', '1password', 'op://only-vault']), log: quiet }),
    ).rejects.toThrow(/expected op:\/\//);
  });

  it('edit pre-fills every answer from the existing profile', async () => {
    const cfg: Config = {
      ...empty(),
      defaultProfile: 'main',
      profiles: { main: { token: { env: 'BOT' }, defaultGuild: 'G', readOnly: true } },
    };
    // accept every default: name, template, env name, skip check, guild, read-only
    const prompts = scripted([undefined, undefined, undefined, false, undefined, undefined]);
    const r = await profileWizard(cfg, 'main', { prompts, verify: okVerify, log: quiet });
    expect(r).toEqual({ name: 'main', profile: cfg.profiles.main, makeDefault: true });
  });
});

describe('applyProfile / removeProfile', () => {
  const base: Config = { path: '/c', defaultProfile: 'a', profiles: { a: {}, b: { readOnly: true } } };

  it('renames in place and carries the default along', () => {
    const out = applyProfile(base, { name: 'z', profile: {}, makeDefault: false }, 'a');
    expect(Object.keys(out.profiles)).toEqual(['z', 'b']);
    expect(out.defaultProfile).toBe('z');
  });

  it('adds and optionally makes default', () => {
    expect(applyProfile(base, { name: 'c', profile: {}, makeDefault: true }).defaultProfile).toBe('c');
    expect(applyProfile(base, { name: 'c', profile: {}, makeDefault: false }).defaultProfile).toBe('a');
  });

  it('removing the default hands it to nextDefault, or clears it', () => {
    expect(removeProfile(base, 'a', 'b').defaultProfile).toBe('b');
    expect('defaultProfile' in removeProfile(base, 'a')).toBe(false);
    expect(removeProfile(base, 'b').defaultProfile).toBe('a');
    expect(() => removeProfile(base, 'nope')).toThrow(/no profile/);
  });

  it('lists profiles without leaking command arguments', () => {
    const rows = profileRows({ ...base, profiles: { a: { token: { command: ['echo', 'tok'] } } } });
    expect(rows[0]).toMatchObject({ name: 'a', default: '*' });
    expect(JSON.stringify(rows)).not.toMatch(/tok"/);
  });
});

describe('runProfileCommand / runOnboarding (on disk)', () => {
  const tmpConfig = (obj?: unknown) => {
    const p = join(mkdtempSync(join(tmpdir(), 'dcsh-')), 'config.json');
    if (obj) writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

  it('onboarding writes a config with a default profile', async () => {
    const p = tmpConfig();
    const prompts = scripted([true, undefined, 'env', undefined, false, '', false]);
    expect(await runOnboarding(p, { prompts, log: quiet })).toBe(true);
    expect(read(p)).toEqual({ defaultProfile: 'default', profiles: { default: { token: { env: 'DISCORD_TOKEN' } } } });
  });

  it('onboarding can be declined and writes nothing', async () => {
    const p = tmpConfig();
    expect(await runOnboarding(p, { prompts: scripted([false]), log: quiet })).toBe(false);
    expect(() => readFileSync(p)).toThrow();
  });

  it('remove -y works without a terminal and reassigns the default', async () => {
    const p = tmpConfig({ defaultProfile: 'a', profiles: { a: {}, b: {} } });
    const code = await runProfileCommand('rm', 'a', { config: p, yes: true }, { interactive: false, log: quiet });
    expect(code).toBe(0);
    expect(read(p)).toEqual({ defaultProfile: 'b', profiles: { b: {} } });
  });

  it('add refuses without a terminal; unknown subcommand prints usage and fails', async () => {
    const p = tmpConfig();
    await expect(
      runProfileCommand('add', undefined, { config: p }, { interactive: false, log: quiet }),
    ).rejects.toThrow(/interactive terminal/);
    expect(await runProfileCommand('frobnicate', undefined, { config: p }, { log: quiet })).toBe(1);
  });
});
