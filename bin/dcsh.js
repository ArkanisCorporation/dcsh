#!/usr/bin/env node
import repl from 'node:repl';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { Routes, ChannelType, PermissionFlagsBits } from 'discord-api-types/v10';
import { loadConfig, pickTokenSource, describeSource, resolveToken, stateDir } from '../src/config.js';
import { Session } from '../src/session.js';
import { parse, dispatch, KEYWORDS, SHOW_TARGETS } from '../src/commands.js';

const USAGE = `dcsh: Discord REST shell

Usage: dcsh [options]

  -p, --profile <name>    bot profile from config (default: config.defaultProfile)
  -g, --guild <id|name>   server to activate on start (default: profile.defaultGuild)
      --token-cmd <cmd>   run a command, use stdout as token (e.g. vault kv get -field=token ...)
      --token-env <var>   read token from an environment variable
      --token-file <path> read token from a file (must be mode 600 on Unix)
      --token-prompt      prompt for the token (hidden input)
      --read-only         block all mutating requests for this session
      --operator <name>   name used in audit log reasons (default: OS username)
      --config <path>     config file (default: $XDG_CONFIG_HOME/dcsh/config.json)
  -h, --help

With no token flag or profile: $DISCORD_TOKEN, then an interactive prompt.`;

const { values: flags } = parseArgs({
  options: {
    profile: { type: 'string', short: 'p' },
    guild: { type: 'string', short: 'g' },
    'token-cmd': { type: 'string' },
    'token-env': { type: 'string' },
    'token-file': { type: 'string' },
    'token-prompt': { type: 'boolean' },
    'read-only': { type: 'boolean' },
    operator: { type: 'string' },
    config: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (flags.help) { console.log(USAGE); process.exit(0); }

const fail = (err) => { console.error(`dcsh: ${formatError(err)}`); process.exit(1); };
const config = (() => { try { return loadConfig(flags.config); } catch (e) { fail(e); } })();
const session = new Session({ operator: flags.operator ?? config.operator ?? userInfo().username });

async function activate(profileName, { atStartup }) {
  const profile = profileName ? config.profiles[profileName] : null;
  if (profileName && !profile) throw new Error(`unknown profile "${profileName}" in ${config.path}`);
  const src = atStartup ? pickTokenSource(flags, profile) : profile.token;
  const token = await resolveToken(src, { allowPrompt: atStartup });
  await session.connect(token, {
    profile: profileName,
    readOnly: Boolean(profile?.readOnly || flags['read-only']),
  });
  console.log(`connected as ${session.me.username} (${session.me.id}) via ${describeSource(src)}`);
  const guildRef = (atStartup && flags.guild) || profile?.defaultGuild;
  if (guildRef) {
    await session.use(guildRef);
    console.log(`active server: ${session.guild.name} (${session.guild.id})`);
  }
}

try {
  await activate(flags.profile ?? config.defaultProfile, { atStartup: true });
} catch (e) { fail(e); }

const promptText = () => {
  const ro = session.readOnly ? ' [ro]' : '';
  const where = session.guild ? `/${session.guild.name}` : '';
  return `${session.profile ?? session.me.username}${where}${ro}> `;
};

console.log('type `help` for statements');
const server = repl.start({ prompt: promptText(), ignoreUndefined: true, breakEvalOnSigint: true });

function installContext(ctx) {
  const ro = (name, get) => Object.defineProperty(ctx, name, { get, enumerable: true, configurable: true });
  ro('api', () => session.api);
  ro('guild', () => session.guild);
  ro('guildId', () => session.guild?.id);
  ro('me', () => session.me);
  Object.assign(ctx, { Routes, ChannelType, PermissionFlagsBits });
}
installContext(server.context);
server.on('reset', installContext);

const defaultEval = server.eval;
// Statements are serialized: later lines (pasted/piped) wait until a pending statement finishes.
// Plain JS keeps Node's native semantics; a rejected top-level await never calls the eval
// callback, so JS evaluations must not hold the queue.
let pending = Promise.resolve();
let inFlight = 0;
server.eval = (code, context, file, cb) => {
  const finish = (err, result) => { server.setPrompt(promptText()); cb(err, result); };
  const stmt = parse(code);
  if (!stmt) {
    // Synchronous when idle, so multi-line input (Recoverable errors) keeps working.
    const run = () => defaultEval.call(server, code, context, file, finish);
    return inFlight === 0 ? run() : void pending.then(run);
  }
  inFlight++;
  pending = pending.then(() =>
    dispatch(stmt, { session, config, switchProfile: (name) => activate(name, { atStartup: false }) })
      .catch((err) => console.error(formatError(err)))
      .finally(() => { inFlight--; finish(null, undefined); }));
};

const defaultCompleter = server.completer;
server.completer = (line, cb) => {
  const [head, ...rest] = line.split(/\s+/);
  const word = rest.join(' ');
  const done = (list) => {
    const hits = list.filter((c) => c.toLowerCase().startsWith(word.toLowerCase()));
    cb(null, [hits, word]);
  };
  if (rest.length === 0) {
    return defaultCompleter.call(server, line, (err, [hits, sub]) =>
      cb(err, [[...KEYWORDS.filter((k) => k.startsWith(line)), ...hits], sub]));
  }
  if (head === 'show') return done(SHOW_TARGETS);
  if (head === 'profile') return done(Object.keys(config.profiles));
  if (head === 'readonly') return done(['on', 'off']);
  if (head === 'use') return done([...(session.guildCache ?? []).flatMap((g) => [g.id, g.name]), 'none']);
  return defaultCompleter.call(server, line, cb);
};

server.setupHistory(join(stateDir(), 'history'), (err) => {
  if (err) console.error(`history disabled: ${err.message}`);
});

function formatError(err) {
  if (err?.rawError) return `${err.status ?? ''} ${err.method ?? ''} ${err.url ?? ''}\n  ${err.code}: ${err.message}`.trim();
  return err?.message ?? String(err);
}
