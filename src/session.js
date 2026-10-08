import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

const MUTATING = ['post', 'put', 'patch', 'delete'];

export class Session {
  #rest = null;
  #hardReadOnly = false;

  constructor({ operator }) {
    this.operator = operator;
    this.profile = null;
    this.me = null;
    this.guild = null;
    this.guildCache = null;
    this.reason = null;
    this.readOnly = false;
  }

  async connect(token, { profile = null, readOnly = false } = {}) {
    const rest = new REST({ version: '10' }).setToken(token);
    const me = await rest.get(Routes.user('@me'));
    if (!me.bot) throw new Error('token is not a bot token; refusing');
    this.#rest = rest;
    this.me = me;
    this.profile = profile;
    this.guild = null;
    this.guildCache = null;
    this.#hardReadOnly = readOnly;
    this.readOnly = readOnly;
  }

  setReadOnly(on) {
    if (!on && this.#hardReadOnly) throw new Error('read-only is enforced by profile/flag for this session');
    this.readOnly = on;
  }

  /** Guarded API: GETs pass through; mutations need a reason and respect read-only. */
  get api() {
    const rest = this.#rest;
    if (!rest) throw new Error('not connected');
    const api = { get: (route, opts) => rest.get(route, opts) };
    for (const method of MUTATING) {
      api[method] = (route, opts = {}) => {
        if (this.readOnly) throw new Error(`read-only session: ${method.toUpperCase()} ${route} blocked`);
        const reason = opts.reason ?? this.reason;
        if (!reason) throw new Error('mutation needs an audit log reason: `reason <text>` or pass { reason }');
        const full = `[dcsh:${this.operator}] ${reason}`.slice(0, 512);
        return rest[method](route, { ...opts, reason: full });
      };
    }
    return Object.freeze(api);
  }

  async listGuilds({ refresh = false } = {}) {
    if (this.guildCache && !refresh) return this.guildCache;
    const out = [];
    let after;
    for (;;) {
      const query = new URLSearchParams({ limit: '200' });
      if (after) query.set('after', after);
      const page = await this.api.get(Routes.userGuilds(), { query });
      out.push(...page);
      if (page.length < 200) break;
      after = page.at(-1).id;
    }
    this.guildCache = out;
    return out;
  }

  async use(ref) {
    if (/^\d{17,20}$/.test(ref)) {
      this.guild = await this.api.get(Routes.guild(ref));
      return this.guild;
    }
    const needle = ref.toLowerCase();
    const hits = (await this.listGuilds()).filter((g) => g.name.toLowerCase().includes(needle));
    if (hits.length === 0) throw new Error(`no server matching "${ref}"`);
    if (hits.length > 1) {
      const exact = hits.filter((g) => g.name.toLowerCase() === needle);
      if (exact.length !== 1) {
        throw new Error(`ambiguous: ${hits.map((g) => `${g.name} (${g.id})`).join(', ')}`);
      }
      hits.splice(0, hits.length, exact[0]);
    }
    this.guild = await this.api.get(Routes.guild(hits[0].id));
    return this.guild;
  }

  requireGuild() {
    if (!this.guild) throw new Error('no active server: `use <id|name>` first');
    return this.guild;
  }
}
