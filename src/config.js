import { readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import readline from 'node:readline';

const isWin = platform() === 'win32';

export function configDir() {
  if (process.env.DCSH_CONFIG_DIR) return process.env.DCSH_CONFIG_DIR;
  return isWin
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'dcsh')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dcsh');
}

export function stateDir() {
  const dir = isWin
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dcsh')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'dcsh');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const SOURCE_KEYS = ['command', 'env', 'file', 'prompt'];

export function loadConfig(path) {
  const p = path ?? join(configDir(), 'config.json');
  if (!existsSync(p)) return { path: p, profiles: {} };
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const profiles = raw.profiles ?? {};
  for (const [name, prof] of Object.entries(profiles)) {
    const t = prof.token;
    if (typeof t !== 'object' || t === null || !SOURCE_KEYS.some((k) => k in t)) {
      throw new Error(
        `${p}: profile "${name}" needs token: { ${SOURCE_KEYS.join(' | ')} }. Literal tokens are not supported.`,
      );
    }
  }
  return { ...raw, path: p, profiles };
}

/**
 * Builds the token source from CLI flags, the selected profile, or the environment.
 * Precedence: explicit --token-* flag > profile > $DISCORD_TOKEN > interactive prompt.
 */
export function pickTokenSource(flags, profile) {
  if (flags['token-cmd']) return { command: flags['token-cmd'] };
  if (flags['token-env']) return { env: flags['token-env'] };
  if (flags['token-file']) return { file: flags['token-file'] };
  if (flags['token-prompt']) return { prompt: true };
  if (profile?.token) return profile.token;
  if (process.env.DISCORD_TOKEN) return { env: 'DISCORD_TOKEN' };
  return { prompt: true };
}

export function describeSource(src) {
  if (src.command) return `command (${Array.isArray(src.command) ? src.command[0] : src.command.split(' ')[0]} ...)`;
  if (src.env) return `env $${src.env}`;
  if (src.file) return `file ${src.file}`;
  return 'interactive prompt';
}

export async function resolveToken(src, { allowPrompt = true } = {}) {
  if (src.command) {
    const opts = { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] };
    const out = Array.isArray(src.command)
      ? execFileSync(src.command[0], src.command.slice(1), opts) // no shell: preferred
      : execSync(src.command, opts);
    return clean(out, describeSource(src));
  }
  if (src.env) {
    const v = process.env[src.env];
    if (!v) throw new Error(`$${src.env} is not set`);
    return clean(v, describeSource(src));
  }
  if (src.file) {
    const p = resolve(src.file.replace(/^~(?=$|[\\/])/, homedir()));
    if (!isWin) {
      const mode = statSync(p).mode & 0o777;
      if (mode & 0o077) throw new Error(`${p} has mode ${mode.toString(8)}; chmod 600 it`);
    }
    return clean(readFileSync(p, 'utf8'), describeSource(src));
  }
  if (src.prompt) {
    if (!allowPrompt) throw new Error('interactive token prompt is only available at startup');
    return clean(await promptHidden('Bot token: '), 'prompt');
  }
  throw new Error('no usable token source');
}

function clean(value, from) {
  let t = String(value).trim();
  if (t.startsWith('Bot ')) t = t.slice(4);
  if (!t || /\s/.test(t)) throw new Error(`token from ${from} is empty or malformed`);
  return t;
}

function promptHidden(question) {
  return new Promise((res, rej) => {
    if (!process.stdin.isTTY) return rej(new Error('stdin is not a TTY; use another token source'));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asked = false;
    rl._writeToOutput = (s) => {
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
