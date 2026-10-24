import { formatDecimal } from '@/shared/lib/money';

/**
 * A reception line's `amount` is whole hryvnia by construction (§2.12, #56 —
 * the server's `mulWholeHryvnia`), so the formula line prints it without the
 * «,00» that would make it read as an exact product: «1 430,80 → 1 431 ₴».
 * Formatting only — a value with kopiykas is printed in full, never cut.
 */
export function formatWholeHryvnia(value: string, locale: string): string {
  const full = formatDecimal(value, locale);
  return /\.00$/.test(value) ? full.slice(0, -3) : full;
}
