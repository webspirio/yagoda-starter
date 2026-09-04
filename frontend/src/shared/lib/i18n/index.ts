import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import { getStoredLanguage } from './language-preference';

/**
 * Seed the UI language. A previously persisted manual choice
 * (LanguageSwitcher / storeLanguage) wins if present; otherwise 'en', the
 * only locale this starter ships. Kept as its own function so a project
 * adding a second locale has a single place to widen the fallback logic.
 */
function detectLanguage(): string {
  return getStoredLanguage() ?? 'en';
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
