import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import uk from './locales/uk.json';
import { getStoredLanguage } from './language-preference';

/**
 * Seed the UI language. A previously persisted manual choice
 * (LanguageSwitcher / storeLanguage) wins if present; otherwise 'uk' — this is
 * a Ukrainian-first product (the berry network's own language). English stays
 * registered as the fallback so any not-yet-translated key still resolves.
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

/**
 * To add a locale: create `locales/<code>.json` mirroring `en.json`, add it
 * to `resources` below and to `SUPPORTED_LANGUAGES` (`language-preference.ts`),
 * and it becomes selectable once `storeLanguage` writes that code.
 */
export function initI18n(): void {
  void i18n.use(initReactI18next).init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: { escapeValue: false }, // React already escapes rendered strings
  });

  syncHtmlLang();
  i18n.on('languageChanged', syncHtmlLang);
}

export { i18n };
