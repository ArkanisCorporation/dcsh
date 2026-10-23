/**
 * Profile management: the guided profile wizard, the `dcsh profile add|list|edit|remove`
 * subcommands, and first-run onboarding. The question flow is written against a small `Prompts`
 * interface (backed by @inquirer/prompts at runtime) and an injectable `verify`, so the wizard is
 * testable without a terminal or a Discord token.
 */
import { spawnSync } from 'node:child_process';
import { input, select, confirm } from '@inquirer/prompts';
import { loadConfig, saveConfig, resolveToken } from './config.js';
import { Session } from './session.js';
import {
  TEMPLATES,
  OP_REFERENCE,
  OP_ACCOUNT,
  ENV_NAME,
  onePasswordSource,
  parseOnePassword,
  normalizeOpAccount,
  commandSource,
  commandLine,
  detectTemplate,
  describeCredential,
  type TemplateId,
} from './credentials.js';
import type { Config, Profile, TokenSource } from './types.js';

/** The subset of prompt kinds the wizard uses. */
export interface Prompts {
  input(opts: { message: string; default?: string; validate?: (v: string) => boolean | string }): Promise<string>;
  select<T>(opts: {
    message: string;
    choices: { name: string; value: T; description?: string }[];
    default?: T;
  }): Promise<T>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
}

export const inquirerPrompts: Prompts = {
  input: (opts) => input(opts),
  select: (opts) => select(opts),
  confirm: (opts) => confirm(opts),
};

/** Result of a successful credential check: who the token is, and where it can go. */
export interface Verified {
  username: string;
  guilds: { id: string; name: string }[];
}

/** Resolves the token and asks Discord who it belongs to. Used to offer a server picker. */
export async function verifyCredential(src: TokenSource): Promise<Verified> {
  const session = new Session({ operator: 'setup' });
  await session.connect(await resolveToken(src));
  const guilds = await session.listGuilds();
  return { username: session.me!.username, guilds: guilds.map((g) => ({ id: g.id, name: g.name })) };
}

export interface WizardDeps {
  prompts?: Prompts;
  verify?: (src: TokenSource) => Promise<Verified>;
  log?: (line: string) => void;
}

export interface WizardResult {
  name: string;
  profile: Profile;
  makeDefault: boolean;
}

const PROFILE_NAME = /^[A-Za-z0-9][\w.-]*$/;

/**
 * Asks for everything a profile needs: name, credential template (+ its details), an optional
 * live check that also powers a server picker, default server, read-only mode and whether it
 * becomes the default. With `editing`, every answer is pre-filled from the existing profile.
 */
export async function profileWizard(config: Config, editing?: string, deps: WizardDeps = {}): Promise<WizardResult> {
  const { prompts = inquirerPrompts, verify = verifyCredential, log = console.log } = deps;
  const existing: Profile = editing ? (config.profiles[editing] ?? {}) : {};
  const isFirst = Object.keys(config.profiles).length === 0;

  const name = await prompts.input({
    message: 'Profile name',
    default: editing ?? (isFirst ? 'default' : undefined),
    validate: (v) => {
      if (!PROFILE_NAME.test(v)) return 'letters, digits, `.`, `_`, `-`; must start with a letter or digit';
      if (v !== editing && v in config.profiles) return `profile "${v}" already exists`;
      return true;
    },
  });

  const token = await askCredential(prompts, existing.token, log);

  let guilds: Verified['guilds'] | undefined;
  if (
    await prompts.confirm({
      message: 'Check the token against Discord now?',
      // "Ask every time" would mean typing the token here and again when the shell starts.
      default: token !== undefined,
    })
  ) {
    try {
      const me = await verify(token ?? { prompt: true });
      log(`  ok: token belongs to bot ${me.username}, in ${me.guilds.length} server(s)`);
      guilds = me.guilds;
    } catch (e) {
      log(`  check failed: ${(e as Error).message ?? e}`);
      log('  saving anyway; fix the credential later with `dcsh profile edit`.');
    }
  }

  const defaultGuild = await askDefaultGuild(prompts, guilds, existing.defaultGuild);
  const readOnly = await prompts.confirm({
    message: 'Read-only (block all mutating requests)?',
    default: existing.readOnly ?? false,
  });

  const wasDefault = editing !== undefined && config.defaultProfile === editing;
  const makeDefault =
    isFirst ||
    wasDefault ||
    (await prompts.confirm({ message: 'Make this the default profile?', default: !config.defaultProfile }));

  const profile: Profile = { ...existing };
  if (token) profile.token = token;
  else delete profile.token;
  if (defaultGuild) profile.defaultGuild = defaultGuild;
  else delete profile.defaultGuild;
  if (readOnly) profile.readOnly = true;
  else delete profile.readOnly;

  return { name, profile, makeDefault };
}

/** Template menu + follow-up question. Returns undefined for "ask every time" (no stored token). */
async function askCredential(
  prompts: Prompts,
  current: TokenSource | undefined,
  log: (line: string) => void,
): Promise<TokenSource | undefined> {
  const currentTemplate = current ? detectTemplate(current) : undefined;
  const template = await prompts.select<TemplateId>({
    message: 'Where does the bot token come from?',
    choices: TEMPLATES.map((t) => ({ name: t.name, value: t.id, description: t.description })),
    default: currentTemplate ?? '1password',
  });
  const prev = currentTemplate === template ? current : undefined;

  switch (template) {
    case '1password': {
      if (!hasCommand('op')) log('  note: `op` (1Password CLI) is not on PATH; install it before connecting.');
      const prevOp = parseOnePassword(prev);
      const ref = await prompts.input({
        message: 'Secret reference (op://<vault>/<item>/<field>)',
        default: prevOp?.reference,
        validate: (v) =>
          OP_REFERENCE.test(v.trim()) ||
          'expected op://<vault>/<item>/<field> - in 1Password, open the field menu and pick "Copy Secret Reference"',
      });
      // Optional, but recommended with several accounts: pins `op` to one account and lets a locked
      // account raise the desktop unlock prompt instead of failing.
      const account = normalizeOpAccount(
        await prompts.input({
          message: '1Password account (e.g. my.1password.com, acme.1password.eu; Enter to skip)',
          default: prevOp?.account,
          validate: (v) => {
            const a = normalizeOpAccount(v);
            return (
              a === '' || OP_ACCOUNT.test(a) || 'expected <name>.1password.com, .ca or .eu (see `op account list`)'
            );
          },
        }),
      );
      return onePasswordSource(ref.trim(), account || undefined);
    }
    case 'command': {
      const line = await prompts.input({
        message: 'Command that prints the token',
        default: prev ? commandLine(prev as { command: string | string[] }) : undefined,
        validate: (v) => v.trim() !== '' || 'enter a command',
      });
      return commandSource(line);
    }
    case 'env': {
      const name = await prompts.input({
        message: 'Environment variable name',
        default: prev ? (prev as { env: string }).env : 'DISCORD_TOKEN',
        validate: (v) => ENV_NAME.test(v.trim()) || 'letters, digits and `_`, not starting with a digit',
      });
      return { env: name.trim() };
    }
    case 'file': {
      const file = await prompts.input({
        message: 'Path to the token file',
        default: prev ? (prev as { file: string }).file : undefined,
        validate: (v) => v.trim() !== '' || 'enter a path',
      });
      return { file: file.trim() };
    }
    case 'prompt':
      return undefined;
  }
}

const NO_GUILD = '';

/** Server picker when the token was verified, free text (id or name) otherwise. */
async function askDefaultGuild(
  prompts: Prompts,
  guilds: Verified['guilds'] | undefined,
  current: string | undefined,
): Promise<string | undefined> {
  if (guilds && guilds.length > 0) {
    const choice = await prompts.select<string>({
      message: 'Default server to activate on start',
      choices: [
        { name: '(none)', value: NO_GUILD },
        ...guilds.map((g) => ({ name: `${g.name} (${g.id})`, value: g.id })),
      ],
      default: current && guilds.some((g) => g.id === current) ? current : NO_GUILD,
    });
    return choice || undefined;
  }
  const typed = await prompts.input({
    message: 'Default server id or name (optional, Enter to skip)',
    default: current,
  });
  return typed.trim() || undefined;
}

function hasCommand(bin: string): boolean {
  const res = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return !res.error;
}

/**
 * Applies a wizard result to the config. Handles renames (the old key goes away and a default
 * pointing at it follows), and keeps insertion order stable for edits.
 */
export function applyProfile(config: Config, result: WizardResult, previousName?: string): Config {
  const profiles: Record<string, Profile> = {};
  for (const [name, p] of Object.entries(config.profiles)) {
    if (name === previousName) profiles[result.name] = result.profile;
    else if (name !== result.name) profiles[name] = p;
  }
  if (!(result.name in profiles)) profiles[result.name] = result.profile;

  let defaultProfile = config.defaultProfile;
  if (result.makeDefault) defaultProfile = result.name;
  else if (previousName && defaultProfile === previousName) defaultProfile = result.name;
  return withDefault({ ...config, profiles }, defaultProfile);
}

/** Removes a profile. If it was the default, `nextDefault` (or nothing) takes its place. */
export function removeProfile(config: Config, name: string, nextDefault?: string): Config {
  if (!(name in config.profiles)) throw new Error(`no profile named "${name}"`);
  const profiles = Object.fromEntries(Object.entries(config.profiles).filter(([n]) => n !== name));
  const defaultProfile = config.defaultProfile === name ? nextDefault : config.defaultProfile;
  return withDefault({ ...config, profiles }, defaultProfile);
}

function withDefault(config: Config, defaultProfile: string | undefined): Config {
  const out = { ...config };
  if (defaultProfile) out.defaultProfile = defaultProfile;
  else delete out.defaultProfile;
  return out;
}

/** Rows for `profile list`. */
export function profileRows(config: Config): Record<string, string>[] {
  return Object.entries(config.profiles).map(([name, p]) => ({
    name,
    default: name === config.defaultProfile ? '*' : '',
    credential: describeCredential(p.token),
    defaultGuild: p.defaultGuild ?? '',
    readOnly: p.readOnly ? 'yes' : '',
  }));
}

export const PROFILE_USAGE = `Usage: dcsh profile <command> [name] [options]

  list, ls                 show configured profiles
  add [name]               create a profile with a guided questionnaire
  edit [name]              change a profile (answers are pre-filled)
  remove, rm [name]        delete a profile (-y to skip the confirmation)

Options
      --config <path>      config file (default: $XDG_CONFIG_HOME/dcsh/config.json)
  -y, --yes                remove without asking
  -h, --help`;

/** Entry point for `dcsh profile ...`. Returns the process exit code. */
export async function runProfileCommand(
  sub: string | undefined,
  name: string | undefined,
  opts: { config?: string; yes?: boolean },
  deps: WizardDeps & { interactive?: boolean } = {},
): Promise<number> {
  const { prompts = inquirerPrompts, log = console.log, interactive = isInteractive() } = deps;
  const config = loadConfig(opts.config);
  const needTty = () => {
    if (!interactive) throw new Error(`profile ${sub} needs an interactive terminal`);
  };
  const pick = async (verb: string): Promise<string> => {
    if (name) {
      if (!(name in config.profiles)) throw new Error(`no profile named "${name}" in ${config.path}`);
      return name;
    }
    const names = Object.keys(config.profiles);
    if (names.length === 0) throw new Error('no profiles yet; run `dcsh profile add`');
    needTty();
    return prompts.select({ message: `Profile to ${verb}`, choices: names.map((n) => ({ name: n, value: n })) });
  };

  switch (sub) {
    case 'list':
    case 'ls': {
      const rows = profileRows(config);
      if (rows.length === 0) {
        log(`no profiles in ${config.path}; run \`dcsh profile add\``);
        return 0;
      }
      console.table(rows);
      return 0;
    }
    case 'add': {
      needTty();
      if (name && name in config.profiles)
        throw new Error(`profile "${name}" already exists; use \`dcsh profile edit ${name}\``);
      const result = await profileWizard(config, undefined, { ...deps, prompts, log });
      saveConfig(applyProfile(config, result));
      log(`saved profile "${result.name}" to ${config.path}`);
      return 0;
    }
    case 'edit': {
      const target = await pick('edit');
      needTty();
      const result = await profileWizard(config, target, { ...deps, prompts, log });
      saveConfig(applyProfile(config, result, target));
      log(`saved profile "${result.name}" to ${config.path}`);
      return 0;
    }
    case 'remove':
    case 'rm': {
      const target = await pick('remove');
      if (!opts.yes) {
        needTty();
        if (!(await prompts.confirm({ message: `Remove profile "${target}"?`, default: false }))) return 1;
      }
      let next: string | undefined;
      const others = Object.keys(config.profiles).filter((n) => n !== target);
      if (config.defaultProfile === target && others.length > 0) {
        next =
          others.length === 1 || !interactive
            ? others[0]
            : await prompts.select({
                message: 'New default profile',
                choices: others.map((n) => ({ name: n, value: n })),
              });
      }
      saveConfig(removeProfile(config, target, next));
      log(`removed profile "${target}"${next ? `; default is now "${next}"` : ''}`);
      return 0;
    }
    default:
      log(PROFILE_USAGE);
      return sub === undefined || sub === 'help' ? 0 : 1;
  }
}

/**
 * First-run onboarding, offered by `dcsh` with no arguments, no config file and a terminal.
 * Returns true when a profile was created, so the caller can reload the config and connect.
 */
export async function runOnboarding(configPath: string | undefined, deps: WizardDeps = {}): Promise<boolean> {
  const { prompts = inquirerPrompts, log = console.log } = deps;
  const config = loadConfig(configPath);
  log("Welcome to dcsh. No config found, so let's set up your first bot profile.");
  log(`It will be saved to ${config.path}; manage profiles later with \`dcsh profile\`.\n`);
  if (!(await prompts.confirm({ message: 'Set up a profile now?', default: true }))) {
    log('skipped; falling back to $DISCORD_TOKEN or a token prompt.\n');
    return false;
  }
  const result = await profileWizard(config, undefined, { ...deps, prompts, log });
  saveConfig(applyProfile(config, result));
  log(`\nsaved profile "${result.name}". Starting the shell...\n`);
  return true;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Ctrl+C / Ctrl+D inside a prompt: inquirer rejects with this error name. */
export function isPromptCancel(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ExitPromptError';
}
