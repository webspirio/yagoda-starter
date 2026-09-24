import { cmp } from '@/shared/lib/money';

/**
 * Suspicion thresholds — the SAME numbers the reception screen uses; we invent
 * none (`03-scenarios-owner.md:899-900`): the season's record is 701,5 кг
 * gross and 115 crates. These are WARNINGS beside the field, never blocks —
 * the owner standing at the scale reads the weight better than we do.
 */
export const GROSS_SUSPECT_KG = 800;
export const TARE_SUSPECT_UNITS = 120;

export type BlockReason = 'noShift' | 'nothingAccepted' | 'noGrade' | 'noGross' | 'noNet' | null;

/**
 * Why «+ Додати позицію» is inactive — a REASON CODE, resolved to copy by the page.
 *
 * The order is the message. «Того дня тут нічого не приймали» has to win over
 * «оберіть сорт», or the owner who picked the wrong point is told to fix the
 * grade. `noShift` sits on top of the mock's ladder and has no counterpart
 * there at all: the mock has documents over a flat date, while here a weighing
 * needs the shift that (point, date) resolves to, and no shift is no screen.
 *
 * The mock's «Товар … не приймали» rung is GONE: the picker is built from the
 * server's `grades[]`, so an unaccepted grade is unpickable rather than
 * pickable-then-refused.
 */
export function addBlockReason({
  hasShift,
  acceptedAnything,
  gradeId,
  grossKg,
  netKg,
}: {
  hasShift: boolean;
  acceptedAnything: boolean;
  gradeId: string | null;
  grossKg: string;
  netKg: string;
}): BlockReason {
  if (!hasShift) return 'noShift';
  if (!acceptedAnything) return 'nothingAccepted';
  if (!gradeId) return 'noGrade';
  if (cmp(grossKg, '0.00') <= 0) return 'noGross';
  if (cmp(netKg, '0.00') <= 0) return 'noNet';
  return null;
}

/** Above the season's heaviest line — «перевірте вагу», not «не можна». */
export function grossHint(grossKg: string): boolean {
  return cmp(grossKg, `${GROSS_SUSPECT_KG}.00`) > 0;
}

/**
 * Two different warnings, never both: too many crates to be believable, or no
 * crates at all under a real gross — in which case the berry's own container
 * weight would walk into the чиста вага untouched.
 */
export function tareHint(units: number, grossKg: string): 'tooMany' | 'none' | null {
  if (units > TARE_SUSPECT_UNITS) return 'tooMany';
  if (units === 0 && cmp(grossKg, '0.00') > 0) return 'none';
  return null;
}
