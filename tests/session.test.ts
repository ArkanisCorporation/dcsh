import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ method: string; route: string; opts: unknown }> = [];
vi.mock('@discordjs/rest', () => {
  class REST {
    setToken() {
      return this;
    }
    get(route: string, opts: unknown) {
      // discord-api-types URL-encodes `@me` -> `%40me`, so match the encoded form.
      if (route.endsWith('%40me')) return Promise.resolve({ id: '1', username: 'bot', bot: true });
      calls.push({ method: 'get', route, opts });
      return Promise.resolve([]);
    }
    post(route: string, opts: unknown) {
      calls.push({ method: 'post', route, opts });
      return Promise.resolve({});
    }
    delete(route: string, opts: unknown) {
      calls.push({ method: 'delete', route, opts });
      return Promise.resolve({});
    }
  }
  return { REST };
});

const { Session } = await import('../src/session.js');
const { Routes } = await import('discord-api-types/v10');

describe('mutation guard', () => {
  beforeEach(() => {
    calls.length = 0;
  });

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
    expect(calls).toHaveLength(0); // guard throws before the REST client is reached
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
    const rest = await import('@discordjs/rest');
    vi.spyOn(rest.REST.prototype, 'get').mockResolvedValueOnce({ id: '1', username: 'u', bot: false } as never);
    await expect(s.connect('t', {})).rejects.toThrow(/not a bot token/);
  });
});
