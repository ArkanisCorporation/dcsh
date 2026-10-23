/**
 * Credential templates: the menu of ways a profile can obtain its bot token, as offered by the
 * profile wizard. Each template maps user answers onto one of the existing `TokenSource` shapes,
 * so nothing here widens what the config accepts - in particular there is still no literal-token
 * shape. Pure logic only; the interactive questions live in `profiles.ts`.
 */
import { describeSource } from './config.js';
import type { TokenSource } from './types.js';

export type TemplateId = '1password' | 'command' | 'env' | 'file' | 'prompt';

export interface CredentialTemplate {
  id: TemplateId;
  /** Menu label. */
  name: string;
  /** One-line hint shown under the menu entry. */
  description: string;
}

export const TEMPLATES: readonly CredentialTemplate[] = [
  {
    id: '1password',
    name: '1Password',
    description: 'resolve an op:// secret reference with the 1Password CLI (`op read`) on each start',
  },
  {
    id: 'command',
    name: 'Custom command',
    description: 'run a command and use its stdout as the token (vault, pass, secret-tool, ...)',
  },
  { id: 'env', name: 'Environment variable', description: 'read the token from an environment variable' },
  { id: 'file', name: 'Token file', description: 'read the token from a file (must be chmod 600 on Unix)' },
  { id: 'prompt', name: 'Ask every time', description: 'store nothing; dcsh prompts for the token on start' },
];

/**
 * 1Password secret reference: `op://<vault>/<item>/[<section>/]<field>`. Vault and item may be
 * names or ids. Names may contain spaces ("Shared Vault"); that is safe because the reference is
 * passed as a single argv entry, never through a shell. Segments must be non-blank.
 */
export const OP_REFERENCE = /^op:\/\/[^/\n]*\S[^/\n]*\/[^/\n]*\S[^/\n]*\/[^/\n]*\S[^/\n]*(?:\/[^/\n]*\S[^/\n]*)?$/;

/**
 * Shape of a Discord bot token (three base64url segments). Used to catch the token itself being
 * pasted into a field that would store it in the config, e.g. "Custom command" or "Token file".
 */
const DISCORD_TOKEN_SHAPE = /[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}/;

export function looksLikeToken(value: string): boolean {
  return DISCORD_TOKEN_SHAPE.test(value);
}

/** Validator message for fields where a pasted token would end up in the config. */
export const TOKEN_PASTED =
  'that looks like the bot token itself - dcsh never stores tokens; enter where to fetch it from instead';

/** Name rule for `env` templates: a portable environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 1Password account sign-in address: `<subdomain>.1password.(com|ca|eu)`, e.g. `my.1password.com`
 * or a team/business `acme.1password.eu`. Passed as `op --account`, which pins resolution to that
 * account: without it `op` can pick the wrong one when several are signed in, or fail instead of
 * raising the desktop app's unlock prompt when the target account is locked.
 */
export const OP_ACCOUNT = /^[a-z0-9][a-z0-9-]*\.1password\.(?:com|ca|eu)$/;

/** Lenient input for the account question: tolerates case and a pasted URL (`https://x.1password.com/`). */
export function normalizeOpAccount(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

/** A parsed 1Password source: the secret reference and the optional account scope. */
export interface OnePasswordRef {
  reference: string;
  account?: string;
}

/** Builds the 1Password token source. argv form, so no shell is involved. */
export function onePasswordSource(reference: string, account?: string): TokenSource {
  return { command: account ? ['op', '--account', account, 'read', reference] : ['op', 'read', reference] };
}

// Anything a shell would interpret. Without these, splitting on whitespace is exactly what the
// shell would have done, so the command can safely run without one (the config's preferred form).
// `%` covers cmd.exe variables; a leading `VAR=value` word is a shell env assignment.
const SHELL_SYNTAX = /["'`$\\|&;<>(){}*?[\]~#!%]|^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Converts a typed command line into a `command` source: an argv array when it is plain words,
 * otherwise the string form, which runs through a shell. Always the string form on Windows, where
 * `.cmd`/`.bat` wrappers (common for CLIs installed via npm or scoop) cannot be spawned as argv.
 */
export function commandSource(line: string, platform: NodeJS.Platform = process.platform): TokenSource {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('command is empty');
  const shell = platform === 'win32' || SHELL_SYNTAX.test(trimmed);
  return { command: shell ? trimmed : trimmed.split(/\s+/) };
}

/**
 * Inverse of `commandSource`, for pre-filling the wizard when editing. argv entries containing
 * whitespace are quoted, so saving the line unchanged keeps them as one argument (via the shell).
 */
export function commandLine(src: { command: string | string[] }): string {
  if (!Array.isArray(src.command)) return src.command;
  return src.command.map((a) => (/\s/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ');
}

/** Recognises which template a stored source came from. A missing token means "ask every time". */
export function detectTemplate(src: TokenSource | undefined): TemplateId {
  if (!src || 'prompt' in src) return 'prompt';
  if ('env' in src) return 'env';
  if ('file' in src) return 'file';
  return parseOnePassword(src) ? '1password' : 'command';
}

/**
 * Recognises exactly the argv shapes `onePasswordSource` produces - `op read <ref>` and
 * `op --account <addr> read <ref>` - so anything hand-tuned stays a plain custom command.
 */
export function parseOnePassword(src: TokenSource | undefined): OnePasswordRef | undefined {
  if (!src || !('command' in src) || !Array.isArray(src.command)) return undefined;
  const [bin, ...args] = src.command;
  if (bin !== 'op') return undefined;
  let account: string | undefined;
  if (args[0] === '--account') {
    account = args[1];
    if (!account || !OP_ACCOUNT.test(account)) return undefined;
    args.splice(0, 2);
  }
  const [verb, reference, ...rest] = args;
  if (verb !== 'read' || !reference || rest.length > 0 || !OP_REFERENCE.test(reference)) return undefined;
  return account ? { reference, account } : { reference };
}

/**
 * Short human description of a profile's credential for `profile list`. Never shows a value, and
 * like `describeSource` shows only a command's program name, since arguments can be sensitive.
 */
export function describeCredential(src: TokenSource | undefined): string {
  if (!src) return 'ask every time';
  const op = parseOnePassword(src);
  if (!op) return describeSource(src);
  return op.account ? `1Password ${op.reference} (${op.account})` : `1Password ${op.reference}`;
}
