/** A profile/flag specifies the bot token through exactly one of these four shapes. */
export type TokenSource = { command: string | string[] } | { env: string } | { file: string } | { prompt: true };

/** One configured bot profile from the config file. */
export interface Profile {
  token?: TokenSource;
  defaultGuild?: string;
  readOnly?: boolean;
}

/** The parsed config file, plus the resolved `path` it was loaded from. */
export interface Config {
  path: string;
  defaultProfile?: string;
  operator?: string;
  profiles: Record<string, Profile>;
}

/** Shell statement keywords (as opposed to raw JavaScript lines). */
export type Keyword = 'show' | 'use' | 'profile' | 'reason' | 'readonly' | 'whoami' | 'help';

/** A line parsed as a shell statement: a keyword and its (possibly empty) argument. */
export interface Statement {
  cmd: Keyword;
  arg: string;
}

/** Options accepted by a guarded mutating request. `reason` drives the audit-log entry. */
export interface MutateOptions {
  reason?: string;
  body?: unknown;
  query?: URLSearchParams;
  [key: string]: unknown;
}

/** The guarded REST surface exposed in the REPL: GETs pass through, mutations are checked. */
export interface GuardedApi {
  get(route: string, opts?: { query?: URLSearchParams }): Promise<unknown>;
  post(route: string, opts?: MutateOptions): Promise<unknown>;
  put(route: string, opts?: MutateOptions): Promise<unknown>;
  patch(route: string, opts?: MutateOptions): Promise<unknown>;
  delete(route: string, opts?: MutateOptions): Promise<unknown>;
}
