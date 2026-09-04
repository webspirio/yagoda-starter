import { describe, it, expect, afterEach } from 'vitest';
import { i18n, initI18n } from './index';
import { storeLanguage } from './language-preference';

afterEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});

describe('<html lang> tracks the rendered language', () => {
  it('says en when the UI is English', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('reports the resolved language, not the requested one', async () => {
    // Only 'en' is registered, so any unsupported locale falls back to it —
    // lang must describe what is on screen, never what was asked for.
    await i18n.changeLanguage('de');
    expect(document.documentElement.lang).toBe(i18n.resolvedLanguage);
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('detectLanguage priority', () => {
  it('a persisted language wins on init', () => {
    storeLanguage('en');
    initI18n();
    expect(i18n.resolvedLanguage).toBe('en');
  });
});
