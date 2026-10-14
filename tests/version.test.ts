import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readVersion } from '../src/version.js';

describe('readVersion', () => {
  it('returns the version from the package manifest', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(readVersion()).toBe(pkg.version);
  });

  it('returns a semver-looking string, never "unknown", when run from the repo', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
