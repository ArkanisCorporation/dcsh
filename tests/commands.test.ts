import { describe, it, expect } from 'vitest';
import { parse } from '../src/commands.js';

describe('parse', () => {
  it('parses statements', () => {
    expect(parse('show servers')).toEqual({ cmd: 'show', arg: 'servers' });
    expect(parse('use Arkanis')).toEqual({ cmd: 'use', arg: 'Arkanis' });
    expect(parse('help')).toEqual({ cmd: 'help', arg: '' });
  });

  it('does NOT intercept JavaScript that starts with a keyword', () => {
    expect(parse('show(x)')).toBeNull();
    expect(parse('reason.length')).toBeNull();
    expect(parse('use = 1')).toBeNull();
  });

  it('returns null for non-keywords', () => {
    expect(parse('await api.get(x)')).toBeNull();
  });
});
