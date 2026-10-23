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
 * names or ids; whitespace is rejected because the reference is passed as a single argv entry.
 */
export const OP_REFERENCE = /^op:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+(?:\/[^/\s]+)?$/;

/** Name rule for `env` templates: a portable environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Builds the 1Password token source. argv form, so no shell is involved. */
export function onePasswordSource(reference: string): TokenSource {
  return { command: ['op', 'read', reference] };
}

// Anything a shell would interpret. Without these, splitting on whitespace is exactly what the
// shell would have done, so the command can safely run without one (the config's preferred form).
const SHELL_SYNTAX = /["'`$\\|&;<>(){}*?[\]~#!]/;

/**
 * Converts a typed command line into a `command` source: an argv array when it is plain words,
 * otherwise the string form, which runs through a shell.
 */
export function commandSource(line: string): TokenSource {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('command is empty');
  return { command: SHELL_SYNTAX.test(trimmed) ? trimmed : trimmed.split(/\s+/) };
}

/** Inverse of `commandSource`, for pre-filling the wizard when editing. */
export function commandLine(src: { command: string | string[] }): string {
  return Array.isArray(src.command) ? src.command.join(' ') : src.command;
}

/** Recognises which template a stored source came from. A missing token means "ask every time". */
export function detectTemplate(src: TokenSource | undefined): TemplateId {
  if (!src || 'prompt' in src) return 'prompt';
  if ('env' in src) return 'env';
  if ('file' in src) return 'file';
  const ref = onePasswordReference(src);
  return ref ? '1password' : 'command';
}

/** The op:// reference of a 1Password source, or undefined when `src` is not one. */
export function onePasswordReference(src: TokenSource | undefined): string | undefined {
  if (!src || !('command' in src) || !Array.isArray(src.command)) return undefined;
  const [bin, verb, ref, ...rest] = src.command;
  return bin === 'op' && verb === 'read' && ref && rest.length === 0 && OP_REFERENCE.test(ref) ? ref : undefined;
}

/**
 * Short human description of a profile's credential for `profile list`. Never shows a value, and
 * like `describeSource` shows only a command's program name, since arguments can be sensitive.
 */
export function describeCredential(src: TokenSource | undefined): string {
  if (!src) return 'ask every time';
  const ref = onePasswordReference(src);
  return ref ? `1Password ${ref}` : describeSource(src);
}
