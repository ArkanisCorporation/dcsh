#!/usr/bin/env node
import repl from 'node:repl';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { Routes, ChannelType, PermissionFlagsBits } from 'discord-api-types/v10';
import { loadConfig, pickTokenSource, resolveToken, stateDir, defaultConfigPath } from '../src/config.js';
import { describeCredential } from '../src/credentials.js';
import { runProfileCommand, runOnboarding, isInteractive, isPromptCancel, PROFILE_USAGE } from '../src/profiles.js';
import { Session } from '../src/session.js';
import { parse, dispatch, KEYWORDS, SHOW_TARGETS } from '../src/commands.js';
import type { TokenSource } from '../src/types.js';
import { readVersion } from '../src/version.js';

const USAGE = `dcsh: Discord REST shell

Usage: dcsh [options]
       dcsh profile list|add|edit|remove [name]   manage bot profiles (see dcsh profile --help)

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
  -v, --version           print version and exit

With no token flag or profile: $DISCORD_TOKEN, then an interactive prompt.
Run plain \`dcsh\` in a terminal with no config file yet for a guided first-time setup.`;

const fail = (err: unknown): never => {
  console.error(`dcsh: ${formatError(err)}`);
  process.exit(1);
};
// Ctrl+C inside a setup question: leave quietly instead of printing an error.
const failOrCancel = (err: unknown): never => (isPromptCancel(err) ? process.exit(130) : fail(err));

const argv = process.argv.slice(2);

// `dcsh profile ...` is a one-shot subcommand: it never connects or starts the shell.
if (argv[0] === 'profile') {
  try {
    const { values: o, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        config: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (o.help) {
      console.log(PROFILE_USAGE);
      process.exit(0);
    }
    const code = await runProfileCommand(positionals[0], positionals[1], o);
    // stdout to a pipe is async on macOS/Windows: let `profile list | less` drain before exiting.
    await new Promise<void>((done) => process.stdout.write('', () => done()));
    process.exit(code);
  } catch (e) {
    failOrCancel(e);
  }
}

// First run: bare `dcsh`, no config yet, a human at the keyboard -> guided profile setup. Any
// argument (flags, a token source, --config) means the user already knows what they want.
if (argv.length === 0 && !existsSync(defaultConfigPath()) && isInteractive()) {
  try {
    await runOnboarding(undefined);
  } catch (e) {
    failOrCancel(e);
  }
}

const { values: flags } = parseArgs({
  args: argv,
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
    version: { type: 'boolean', short: 'v' },
  },
});

if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

if (flags.version) {
  console.log(readVersion());
  process.exit(0);
}

const config = (() => {
  try {
    return loadConfig(flags.config);
  } catch (e) {
    return fail(e);
  }
})();
const session = new Session({ operator: flags.operator ?? config.operator ?? userInfo().username });

async function activate(profileName: string | undefined, { atStartup }: { atStartup: boolean }): Promise<void> {
  const profile = profileName ? config.profiles[profileName] : null;
  if (profileName && !profile) throw new Error(`unknown profile "${profileName}" in ${config.path}`);
  if (!atStartup && !profile!.token) {
    throw new Error(`profile "${profileName}" has no stored token; start it with \`dcsh -p ${profileName}\``);
  }
  const src: TokenSource = atStartup ? pickTokenSource(flags as Record<string, unknown>, profile) : profile!.token!;
  const token = await resolveToken(src, { allowPrompt: atStartup });
  await session.connect(token, {
    profile: profileName,
    readOnly: Boolean(profile?.readOnly || flags['read-only']),
  });
  console.log(`connected as ${session.me!.username} (${session.me!.id}) via ${describeCredential(src)}`);
  const guildRef = (atStartup && flags.guild) || profile?.defaultGuild;
  if (guildRef) {
    await session.use(guildRef);
    console.log(`active server: ${session.guild!.name} (${session.guild!.id})`);
  }
}

try {
  await activate(flags.profile ?? config.defaultProfile, { atStartup: true });
} catch (e) {
  fail(e);
}

const promptText = (): string => {
  const ro = session.readOnly ? ' [ro]' : '';
  const where = session.guild ? `/${session.guild.name}` : '';
  return `${session.profile ?? session.me!.username}${where}${ro}> `;
};

console.log('type `help` for statements');
const server = repl.start({ prompt: promptText(), ignoreUndefined: true, breakEvalOnSigint: true });

function installContext(ctx: Record<string, unknown>): void {
  const ro = (name: string, get: () => unknown) =>
    Object.defineProperty(ctx, name, { get, enumerable: true, configurable: true });
  ro('api', () => session.api);
  ro('guild', () => session.guild);
  ro('guildId', () => session.guild?.id);
  ro('me', () => session.me);
  Object.assign(ctx, { Routes, ChannelType, PermissionFlagsBits });
}
installContext(server.context);
server.on('reset', installContext);

type ReplEval = (
  code: string,
  context: object,
  file: string,
  cb: (err: Error | null, result?: unknown) => void,
) => void;
type ReplCompleter = (line: string, cb: (err: Error | null, result: [string[], string]) => void) => void;

const defaultEval = server.eval as ReplEval;
// Statements are serialized: later lines (pasted/piped) wait until a pending statement finishes.
// Plain JS keeps Node's native semantics; a rejected top-level await never calls the eval
// callback, so JS evaluations must not hold the queue.
let pending: Promise<unknown> = Promise.resolve();
let inFlight = 0;
(server as { eval: ReplEval }).eval = (code, context, file, cb) => {
  const finish = (err: Error | null, result?: unknown) => {
    server.setPrompt(promptText());
    cb(err, result);
  };
  const stmt = parse(code);
  if (!stmt) {
    // Synchronous when idle, so multi-line input (Recoverable errors) keeps working.
    const run = () => defaultEval.call(server, code, context, file, finish);
    return inFlight === 0 ? run() : void pending.then(run);
  }
  inFlight++;
  pending = pending.then(() =>
    dispatch(stmt, { session, config, switchProfile: (name: string) => activate(name, { atStartup: false }) })
      .catch((err: unknown) => console.error(formatError(err)))
      .finally(() => {
        inFlight--;
        finish(null, undefined);
      }),
  );
};

const defaultCompleter = server.completer as ReplCompleter;
(server as { completer: ReplCompleter }).completer = (line, cb) => {
  const [head, ...rest] = line.split(/\s+/);
  const word = rest.join(' ');
  const done = (list: readonly string[]) => {
    const hits = list.filter((c) => c.toLowerCase().startsWith(word.toLowerCase()));
    cb(null, [hits, word]);
  };
  if (rest.length === 0) {
    return defaultCompleter.call(server, line, (err: Error | null, [hits, sub]: [string[], string]) =>
      cb(err, [[...KEYWORDS.filter((k) => k.startsWith(line)), ...hits], sub]),
    );
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

function formatError(err: unknown): string {
  const e = err as {
    rawError?: unknown;
    status?: number;
    method?: string;
    url?: string;
    code?: string;
    message?: string;
  };
  if (e?.rawError) return `${e.status ?? ''} ${e.method ?? ''} ${e.url ?? ''}\n  ${e.code}: ${e.message}`.trim();
  return e?.message ?? String(err);
}
