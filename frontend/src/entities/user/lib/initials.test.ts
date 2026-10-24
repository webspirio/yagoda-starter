import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first and the last word', () => {
    expect(initialsOf('Alice Operator')).toBe('AO');
    expect(initialsOf('олена петрівна коваль')).toBe('ОК');
  });
  it('gives one letter for one word and «?» for none', () => {
    expect(initialsOf('Ivan')).toBe('I');
    expect(initialsOf('   ')).toBe('?');
  });
});
