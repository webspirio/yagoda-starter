export const SUPPORTED_LANGUAGES = ['uk', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const KEY = 'web-starter:lang';

const isSupported = (v: string | null): v is SupportedLanguage =>
  v != null && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);

export function getStoredLanguage(): SupportedLanguage | null {
  try {
    const v = localStorage.getItem(KEY);
    return isSupported(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeLanguage(code: string): void {
  if (!isSupported(code)) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* storage disabled — ignore */
  }
}
