import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './locales/uk.json';
import { getStoredLanguage } from './language-preference';

/**
 * Seed the UI language. A previously persisted manual choice
 * (LanguageSwitcher / storeLanguage) wins if present; otherwise 'uk' — this is
 * a Ukrainian-first product (the berry network's own language).
 */
function detectLanguage(): string {
  return getStoredLanguage() ?? 'uk';
}

/**
 * Keep <html lang> equal to the language actually rendered. `resolvedLanguage`
 * — not `language` — is the one after fallback, so the attribute always
 * describes what is on screen rather than what was requested.
 */
function syncHtmlLang(): void {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
}

/*
 * ENGLISH IS FETCHED ON DEMAND, NOT SHIPPED IN THE FIRST LOAD.
 *
 * WHY. The first load sat 0.1 KiB raw under its ceiling
 * (scripts/verify/baselines/bundle-budget.json), and every user of this
 * Ukrainian-first product paid for en.json on first paint while almost none
 * render it. As a deferred chunk it leaves the first load: measured by the
 * `bundle` row at 1,059.9 KiB raw / 304.1 KiB gzip before and 1,017.8 / 290.8
 * after (−42.1 raw / −13.3 gzip), still one JS + one CSS file with no
 * `modulepreload` in index.html — the en chunk (13.6 KiB gzip) is fetched
 * only by a user who picks English, or in the background as the fallback.
 * `uk` stays static: it is the default and must paint without a round trip.
 * English is still the fallback, but the `locales` verify row keeps the key
 * sets equal, so uk never needs it before it arrives.
 */
const loadEnglish = async (): Promise<void> => {
  if (i18n.hasResourceBundle('en', 'translation')) return;
  const { default: en } = await import('./locales/en.json');
  i18n.addResourceBundle('en', 'translation', en);
};

/** Switch the UI language, fetching its bundle first if it is not loaded. */
export async function switchLanguage(code: string): Promise<void> {
  if (code === 'en') await loadEnglish();
  await i18n.changeLanguage(code);
}

/**
 * Resolves once the UI can render in the stored language: after English
 * arrives if that is the choice, at once for uk (English then loads in the
 * background as the fallback). To add a locale: create `locales/<code>.json`
 * mirroring `en.json`, load it like `loadEnglish`, and add it to
 * `SUPPORTED_LANGUAGES` (`language-preference.ts`).
 */
export function initI18n(): Promise<void> {
  void i18n.use(initReactI18next).init({
    resources: { uk: { translation: uk } },
    lng: 'uk',
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: { escapeValue: false }, // React already escapes rendered strings
  });

  syncHtmlLang();
  i18n.on('languageChanged', syncHtmlLang);

  if (detectLanguage() === 'en') return switchLanguage('en');
  loadEnglish().catch(() => {}); // only the fallback; a failed fetch leaves uk intact
  return Promise.resolve();
}

export { i18n };
