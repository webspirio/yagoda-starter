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

describe('startup language', () => {
  it('a persisted en waits for English and renders it', async () => {
    // test-setup registers en statically; drop it so this exercises the dynamic import.
    i18n.removeResourceBundle('en', 'translation');
    storeLanguage('en');
    await initI18n();
    expect(i18n.resolvedLanguage).toBe('en');
    expect(i18n.t('lang.label')).toBe('Language');
  });

  it('uk starts in Ukrainian without waiting for English', async () => {
    storeLanguage('uk');
    await initI18n();
    expect(i18n.resolvedLanguage).toBe('uk');
    expect(i18n.t('lang.label')).not.toBe('Language');
  });
});
