import { Routes, ChannelType } from 'discord-api-types/v10';
import type { Statement, Keyword, Config } from './types.js';
import type { Session } from './session.js';

export const KEYWORDS: readonly Keyword[] = ['show', 'use', 'profile', 'reason', 'readonly', 'whoami', 'help'];
export const SHOW_TARGETS = ['servers', 'channels', 'roles', 'members', 'profiles', 'context'] as const;

// Only intercept if the line looks like a statement, not JS (e.g. `show(x)`, `use = 1`, `reason.length`).
const STATEMENT = new RegExp(`^(${KEYWORDS.join('|')})(?:\\s+([^=(.].*))?$`);

export function parse(line: string): Statement | null {
  const m = STATEMENT.exec(line.trim());
  return m ? { cmd: m[1]! as Keyword, arg: (m[2] ?? '').trim() } : null;
}

const HELP = `
Statements
  show servers              servers the bot is in (alias: show guilds)
  show channels [filter]    channels of the active server
  show roles                roles of the active server
  show members [limit]      members (needs the GUILD_MEMBERS privileged intent)
  show profiles             configured bot profiles
  show context | whoami     bot, server, operator, reason, read-only state
  use <id|name>             set the active server (\`use none\` to clear)
  profile <name>            switch to another bot profile
  reason <text>             default audit log reason for mutations (\`reason clear\`)
  readonly on|off           toggle the mutation guard

JavaScript (top-level await works)
  api.get/post/put/patch/delete(route, opts)   guarded REST client
  Routes, ChannelType, PermissionFlagsBits      from discord-api-types/v10
  guild / guildId / me                          active server, its ID, bot user
  e.g. await api.delete(Routes.channel('123'), { reason: 'orphaned VC' })
`;

export async function dispatch(
  { cmd, arg }: Statement,
  {
    session,
    config,
    switchProfile,
  }: { session: Session; config: Config; switchProfile: (name: string) => Promise<void> },
): Promise<unknown> {
  switch (cmd) {
    case 'help':
      return console.log(HELP);

    case 'whoami':
      return showContext(session);

    case 'use':
      if (arg === 'none') {
        session.guild = null;
        return;
      }
      if (!arg) throw new Error('usage: use <id|name>');
      await session.use(arg);
      return console.log(`switched to ${session.guild!.name} (${session.guild!.id})`);

    case 'profile':
      if (!arg) throw new Error('usage: profile <name>');
      return switchProfile(arg);

    case 'reason':
      if (!arg) return console.log(session.reason ?? '(none)');
      session.reason = arg === 'clear' ? null : arg;
      return;

    case 'readonly':
      if (!['on', 'off'].includes(arg)) return console.log(session.readOnly ? 'on' : 'off');
      return session.setReadOnly(arg === 'on');

    case 'show':
      return show(arg, session, config);
  }
}

// Narrow structural shapes for the fields the row-mappings read. Guild channels/roles/members
// always carry these (unlike the full APIChannel union, whose DM variants allow null names).
type ChannelRow = { id: string; type: number; name: string; parent_id?: string | null; position: number };
type RoleRow = { id: string; name: string; position: number; managed: boolean };
type MemberRow = { user: { id: string; username: string; bot?: boolean }; nick?: string | null };

async function show(arg: string, session: Session, config: Config): Promise<unknown> {
  const [target, ...rest] = arg.split(/\s+/);
  const param = rest.join(' ');
  switch (target) {
    case 'servers':
    case 'guilds': {
      const guilds = await session.listGuilds({ refresh: true });
      return console.table(guilds.map((g) => ({ id: g.id, name: g.name, owner: g.owner ? 'yes' : '' })));
    }
    case 'channels': {
      const g = session.requireGuild();
      const chans = (await session.api.get(Routes.guildChannels(g.id))) as ChannelRow[];
      const byId = new Map(chans.map((c) => [c.id, c]));
      const rows = chans
        .filter((c) => !param || c.name.toLowerCase().includes(param.toLowerCase()))
        .sort((a, b) => sortKey(a, byId).localeCompare(sortKey(b, byId)))
        .map((c) => ({
          id: c.id,
          type: ChannelType[c.type] ?? c.type,
          name: c.name,
          category: (c.parent_id ? byId.get(c.parent_id)?.name : '') ?? '',
        }));
      return console.table(rows);
    }
    case 'roles': {
      const g = session.requireGuild();
      const roles = (await session.api.get(Routes.guildRoles(g.id))) as RoleRow[];
      return console.table(
        roles
          .sort((a, b) => b.position - a.position)
          .map((r) => ({
            id: r.id,
            name: r.name,
            position: r.position,
            managed: r.managed ? 'yes' : '',
          })),
      );
    }
    case 'members': {
      const g = session.requireGuild();
      const limit = Math.min(Number(param) || 100, 1000);
      try {
        const members = (await session.api.get(Routes.guildMembers(g.id), {
          query: new URLSearchParams({ limit: String(limit) }),
        })) as MemberRow[];
        return console.table(
          members.map((m) => ({
            id: m.user.id,
            user: m.user.username,
            nick: m.nick ?? '',
            bot: m.user.bot ? 'yes' : '',
          })),
        );
      } catch (err) {
        if ((err as { status?: number }).status === 403)
          throw new Error('403: enable the GUILD_MEMBERS privileged intent for this bot', {
            cause: err,
          });
        throw err;
      }
    }
    case 'profiles':
      return console.table(
        Object.entries(config.profiles).map(([name, p]) => ({
          name,
          active: name === session.profile ? '*' : '',
          defaultGuild: p.defaultGuild ?? '',
          readOnly: p.readOnly ? 'yes' : '',
        })),
      );
    case 'context':
      return showContext(session);
    default:
      throw new Error(`usage: show ${SHOW_TARGETS.join('|')}`);
  }
}

function sortKey(c: ChannelRow, byId: Map<string, ChannelRow>): string {
  const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
  const pad = (n: number | undefined) => String(n ?? 0).padStart(5, '0');
  // Categories first by position, then their children; uncategorized on top.
  return c.type === ChannelType.GuildCategory
    ? `${pad(c.position)}`
    : `${parent ? pad(parent.position) : '00000'}.${pad(c.position)}`;
}

function showContext(s: Session): void {
  console.table({
    bot: `${s.me!.username} (${s.me!.id})`,
    profile: s.profile ?? '(ad hoc)',
    server: s.guild ? `${s.guild.name} (${s.guild.id})` : '(none)',
    operator: s.operator,
    reason: s.reason ?? '(none)',
    readOnly: s.readOnly,
  });
}
