import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Resolve the package version at runtime, for `dcsh --version`.
 *
 * The published entrypoint runs from `dist/bin/dcsh.js` while `pnpm dev` runs the source from
 * `bin/dcsh.ts` (via tsx), so those two sit at different depths relative to the package root -
 * a fixed relative path to package.json would be correct in only one of them. Walk up from this
 * module's own directory until a package.json with a version is found instead; that holds for the
 * source tree, the build output, and a globally installed package alike.
 *
 * Returns `"unknown"` rather than throwing if no package.json is found (e.g. an unusual install
 * layout) - a version flag should never crash the CLI.
 */
export function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // No readable package.json at this level; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return 'unknown';
}
