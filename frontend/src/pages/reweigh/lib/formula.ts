import type { TFunction } from 'i18next';
import { cmp, formatDecimal } from '@/shared/lib/money';

/** One tare type on a line: how many units, and the per-unit kg when known. */
export interface TareTerm {
  units: number;
  /** `null` — the per-unit weight that reproduces the stored tare is unknown;
   *  the formula then prints the line's stored tare total instead. */
  unitWeightKg: string | null;
}

/**
 * «300,60 − 15,60 − 48 × 1,20 = 227,40» — a line's чиста вага as a formula a
 * person can re-check on a calculator (spec 2026-10-23 W4).
 *
 * PRINTS, NEVER COMPUTES: every figure is one the caller already holds (the
 * server's stored line, or the draft's own preview). The pallet term appears
 * only when non-zero; one `units × weight` term per tare type when every weight
 * is known, otherwise the stored tare total («57,60 тара») — a formula that does
 * not add up is worse than none. `null` when nothing is subtracted at all: «a =
 * a» explains nothing.
 */
export function netFormula(
  t: TFunction,
  locale: string,
  line: { gross: string; pallet: string; tare: TareTerm[]; tareKg: string; net: string },
): string | null {
  const terms: string[] = [];
  if (cmp(line.pallet, '0.00') > 0) terms.push(formatDecimal(line.pallet, locale));

  const known = line.tare.length > 0 && line.tare.every((term) => term.unitWeightKg !== null);
  if (known) {
    for (const term of line.tare) {
      terms.push(
        t('reweigh.formula.tareUnits', {
          units: term.units,
          weight: formatDecimal(term.unitWeightKg as string, locale),
        }),
      );
    }
  } else if (cmp(line.tareKg, '0.00') > 0) {
    terms.push(t('reweigh.formula.tareKg', { kg: formatDecimal(line.tareKg, locale) }));
  }

  if (terms.length === 0) return null;
  return t('reweigh.formula.net', {
    gross: formatDecimal(line.gross, locale),
    terms: terms.join(t('reweigh.formula.join')),
    net: formatDecimal(line.net, locale),
  });
}
