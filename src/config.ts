import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import readline from 'node:readline';
import type { TokenSource, Config, Profile } from './types.js';

const isWin = platform() === 'win32';

export function configDir(): string {
  if (process.env.DCSH_CONFIG_DIR) return process.env.DCSH_CONFIG_DIR;
  return isWin
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'dcsh')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dcsh');
}

export function stateDir(): string {
  const dir = isWin
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dcsh')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'dcsh');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const SOURCE_KEYS = ['command', 'env', 'file', 'prompt'];

export function defaultConfigPath(): string {
  return join(configDir(), 'config.json');
}

/**
 * Loads and validates the config. A missing file yields an empty config. A profile may omit
 * `token`, in which case dcsh prompts for it at startup; a present token must be one of the
 * source shapes - literal token strings are rejected so the config never holds a secret.
 */
export function loadConfig(path?: string): Config {
  const p = path ?? defaultConfigPath();
  if (!existsSync(p)) return { path: p, profiles: {} };
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const profiles: Record<string, Profile> = raw.profiles ?? {};
  for (const [name, prof] of Object.entries<Profile>(profiles)) {
    const t = prof.token;
    if (t === undefined) continue;
    if (typeof t !== 'object' || t === null || !SOURCE_KEYS.some((k) => k in t)) {
      throw new Error(
        `${p}: profile "${name}" token must be { ${SOURCE_KEYS.join(' | ')} } or omitted. Literal tokens are not supported.`,
      );
    }
  }
  return { ...raw, path: p, profiles };
}

/**
 * Writes the config back to `config.path`, preserving unknown top-level keys. The write goes to a
 * temp file and is renamed into place so an interrupted save never leaves a truncated config.
 * Mode 600: the config holds no secrets, but it does map out which secret stores to read.
 */
export function saveConfig(config: Config): void {
  const { path, profiles, ...rest } = config;
  // Human-edited file: settings first, profiles last, regardless of the order keys were set in.
  const data = { defaultProfile: rest.defaultProfile, ...rest, profiles };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Builds the token source from CLI flags, the selected profile, or the environment.
 * Precedence: explicit --token-* flag > profile > $DISCORD_TOKEN > interactive prompt.
 */
export function pickTokenSource(flags: Record<string, unknown>, profile?: Profile | null): TokenSource {
  if (flags['token-cmd']) return { command: flags['token-cmd'] as string };
  if (flags['token-env']) return { env: flags['token-env'] as string };
  if (flags['token-file']) return { file: flags['token-file'] as string };
  if (flags['token-prompt']) return { prompt: true };
  if (profile?.token) return profile.token;
  if (process.env.DISCORD_TOKEN) return { env: 'DISCORD_TOKEN' };
  return { prompt: true };
}

export function describeSource(src: TokenSource): string {
  if ('command' in src)
    return `command (${Array.isArray(src.command) ? src.command[0] : src.command.split(' ')[0]} ...)`;
  if ('env' in src) return `env $${src.env}`;
  if ('file' in src) return `file ${src.file}`;
  return 'interactive prompt';
}

export async function resolveToken(
  src: TokenSource,
  { allowPrompt = true }: { allowPrompt?: boolean } = {},
): Promise<string> {
  if ('command' in src) {
    const out = Array.isArray(src.command)
      ? // no shell: preferred form
        execFileSync(src.command[0]!, src.command.slice(1), { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] })
      : execSync(src.command, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
    return clean(out, describeSource(src));
  }
  if ('env' in src) {
    const v = process.env[src.env];
    if (!v) throw new Error(`$${src.env} is not set`);
    return clean(v, describeSource(src));
  }
  if ('file' in src) {
    const p = resolve(src.file.replace(/^~(?=$|[\\/])/, homedir()));
    if (!isWin) {
      const mode = statSync(p).mode & 0o777;
      if (mode & 0o077) throw new Error(`${p} has mode ${mode.toString(8)}; chmod 600 it`);
    }
    return clean(readFileSync(p, 'utf8'), describeSource(src));
  }
  if ('prompt' in src) {
    if (!allowPrompt) throw new Error('interactive token prompt is only available at startup');
    return clean(await promptHidden('Bot token: '), 'prompt');
  }
  throw new Error('no usable token source');
}

function clean(value: string, from: string): string {
  let t = String(value).trim();
  if (t.startsWith('Bot ')) t = t.slice(4);
  if (!t || /\s/.test(t)) throw new Error(`token from ${from} is empty or malformed`);
  return t;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((res, rej) => {
    if (!process.stdin.isTTY) return rej(new Error('stdin is not a TTY; use another token source'));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asked = false;
    // @ts-expect-error private readline internal used to suppress the echoed prompt
    rl._writeToOutput = (s: string) => {
      if (!asked) {
        process.stdout.write(s);
        asked = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      res(answer);
    });
  });
}
