import type { TFunction } from 'i18next';
import { cmp, formatKg, unbreakable } from '@/shared/lib/money';

/** One tare type on a line: how many units, and the per-unit kg when known. */
interface TareTerm {
  units: number;
  /** `null` — the per-unit weight that reproduces the stored tare is unknown;
   *  the formula then prints the line's stored tare total instead. */
  unitWeightKg: string | null;
}

export interface NetLine {
  gross: string;
  pallet: string;
  tare: TareTerm[];
  tareKg: string;
  net: string;
}

/**
 * What a line's net formula subtracts: the pallet only when non-zero; one
 * `units × weight` term per tare type when every weight is known, otherwise the
 * stored tare total — a formula that does not add up is worse than none.
 */
export interface NetParts {
  pallet: string | null;
  tare:
    | { kind: 'units'; terms: { units: number; weightKg: string }[] }
    | { kind: 'kg'; kg: string }
    | null;
}

/**
 * «300,60 кг − 15,60 кг − 48 шт. × 1,20 кг = 227,40 кг» — a line's чиста вага
 * as a formula a person can re-check on a calculator (spec 2026-10-23 W4).
 *
 * PRINTS, NEVER COMPUTES: every figure is one the caller already holds (the
 * server's stored line, or the draft's own preview). `null` when nothing is
 * subtracted at all: «a = a» explains nothing. `ui/NetFormula` renders it with
 * each operand a traced term; `netFormula` below is the same line as plain text.
 */
export function netParts(line: NetLine): NetParts | null {
  const pallet = cmp(line.pallet, '0.00') > 0 ? line.pallet : null;
  const known = line.tare.length > 0 && line.tare.every((term) => term.unitWeightKg !== null);
  const tare: NetParts['tare'] = known
    ? {
        kind: 'units',
        terms: line.tare.map((term) => ({
          units: term.units,
          weightKg: term.unitWeightKg as string,
        })),
      }
    : cmp(line.tareKg, '0.00') > 0
      ? { kind: 'kg', kg: line.tareKg }
      : null;
  if (pallet === null && tare === null) return null;
  return { pallet, tare };
}

/** A formula key's text without its term tags (`<gross>…</gross>`) — for a `title`. */
const untagged = (text: string) => text.replace(/<\/?[a-zA-Z]+>/g, '');

/** The net formula as plain text, every operand held to its unit — for a `title`. */
export function netFormula(t: TFunction, locale: string, line: NetLine): string | null {
  const parts = netParts(line);
  if (parts === null) return null;
  const kg = (value: string) => unbreakable(formatKg(value, locale));
  const terms: string[] = [];
  if (parts.pallet !== null) terms.push(kg(parts.pallet));
  if (parts.tare?.kind === 'units') {
    for (const term of parts.tare.terms) {
      terms.push(
        untagged(t('reweigh.formula.tareUnits', { units: term.units, weight: kg(term.weightKg) })),
      );
    }
  } else if (parts.tare?.kind === 'kg') {
    terms.push(untagged(t('reweigh.formula.tareKg', { kg: kg(parts.tare.kg) })));
  }
  return untagged(
    t('reweigh.formula.net', { gross: kg(line.gross), net: kg(line.net) }).replace(
      '<terms></terms>',
      terms.join(t('reweigh.formula.join')),
    ),
  );
}
