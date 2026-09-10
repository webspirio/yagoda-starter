import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import uk from './locales/uk.json';

type Json = string | number | boolean | null | { [key: string]: Json };

/** Flattens a nested locale object into the full set of its dotted leaf-key paths. */
function flattenKeys(node: Json, prefix = '', out: Set<string> = new Set()): Set<string> {
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flattenKeys(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

/**
 * i18next plural-category suffixes it looks for on a `count`-driven key.
 * `uk`'s CLDR plural rule needs `_one`/`_few`/`_many`/`_other`; `en`'s needs
 * only `_one`/`_other` — see `shared/lib/i18n` and `transfer.dispute.sent_*`.
 */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

/** Strips a trailing plural-category suffix, if the key carries one. */
function toBaseKey(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : key;
}

/**
 * The plan (`docs/superpowers/plans/2026-09-10-yagoda-cash-transfers-frontend.md`)
 * assumed a test like this already existed and would fail if `en.json`/`uk.json`
 * drifted apart — it did not. Without it, a key added to one locale and
 * forgotten in the other ships silently: `t()` falls back to the raw key
 * string in prod, which nothing here catches until someone notices Ukrainian
 * text reading `pointCash.errors.pointMissing` on screen.
 */
describe('locale key parity — en.json and uk.json carry the same keys', () => {
  const enKeys = flattenKeys(en);
  const ukKeys = flattenKeys(uk);

  it('has no one-sided key once i18next plural suffixes are normalised to their base', () => {
    const enNormalised = new Set([...enKeys].map(toBaseKey));
    const ukNormalised = new Set([...ukKeys].map(toBaseKey));

    const missingInUk = [...enNormalised].filter((k) => !ukNormalised.has(k)).sort();
    const missingInEn = [...ukNormalised].filter((k) => !enNormalised.has(k)).sort();

    const message =
      'en.json and uk.json disagree on their key set.\n' +
      (missingInUk.length ? `Only in en.json:\n  ${missingInUk.join('\n  ')}\n` : '') +
      (missingInEn.length ? `Only in uk.json:\n  ${missingInEn.join('\n  ')}\n` : '');

    expect({ missingInUk, missingInEn }, message).toEqual({ missingInUk: [], missingInEn: [] });
  });

  it('gives every plural family _one/_other in both locales, and _few/_many in uk', () => {
    const pluralBaseOf = (keys: Set<string>) =>
      [...keys].filter((k) => PLURAL_SUFFIXES.some((s) => k.endsWith(s))).map(toBaseKey);

    const pluralBases = new Set([...pluralBaseOf(enKeys), ...pluralBaseOf(ukKeys)]);
    expect(pluralBases.size, 'no plural-suffixed key found — is the fixture data still there?').toBeGreaterThan(0);

    for (const base of pluralBases) {
      expect(enKeys.has(`${base}_one`), `en.json is missing "${base}_one"`).toBe(true);
      expect(enKeys.has(`${base}_other`), `en.json is missing "${base}_other"`).toBe(true);
      expect(ukKeys.has(`${base}_one`), `uk.json is missing "${base}_one"`).toBe(true);
      expect(ukKeys.has(`${base}_other`), `uk.json is missing "${base}_other"`).toBe(true);
      expect(ukKeys.has(`${base}_few`), `uk.json is missing "${base}_few"`).toBe(true);
      expect(ukKeys.has(`${base}_many`), `uk.json is missing "${base}_many"`).toBe(true);
    }
  });
});
