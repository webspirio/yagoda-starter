import { describe, it, expect } from 'vitest';
import { keepKnown } from './keepKnown';

const LEVELS = ['start', 'standard', 'business'] as const;

describe('keepKnown', () => {
  it('keeps null as null, so an absent param still means "use the default"', () => {
    expect(keepKnown(null, LEVELS)).toBeNull();
  });

  it('drops unknown values and keeps the rest in order', () => {
    expect(keepKnown(['galaxy', 'business', 'start'], LEVELS)).toEqual(['business', 'start']);
  });

  it('collapses an all-unknown list to empty rather than to null', () => {
    expect(keepKnown(['galaxy'], LEVELS)).toEqual([]);
  });
});
