import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredLanguage, storeLanguage } from './language-preference';

beforeEach(() => localStorage.clear());

describe('language-preference', () => {
  it('round-trips a supported language', () => {
    storeLanguage('en');
    expect(getStoredLanguage()).toBe('en');
  });

  it('ignores an unsupported language', () => {
    storeLanguage('zz');
    expect(getStoredLanguage()).toBeNull();
  });

  it('returns null when nothing stored', () => {
    expect(getStoredLanguage()).toBeNull();
  });
});
