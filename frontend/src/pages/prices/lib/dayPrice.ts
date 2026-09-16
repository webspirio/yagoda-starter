import { cmp } from '@/shared/lib/money';
import type { SheetCell } from '../model/gradePrice';

/** `null` — nobody has priced this grade. `common` — every reception point
 *  agrees. Otherwise the span of the prices that exist. */
export type DayPrice = { common: string } | { min: string; max: string } | null;

/**
 * «ЦІНА ДНЯ ЗАГАЛЬНА» for one grade.
 *
 * COMPUTED OVER EXACTLY THE SET «ВСТАНОВИТИ ВСІМ» WOULD WRITE — the active
 * RECEPTION points, with the warehouse excluded per §4.8 («склад… якого жест
 * "поставити всім" НЕ чіпає»). Computing it over any other set would let the
 * column promise an agreement the button does not produce: include the
 * warehouse, and every row would read «різні» purely because the warehouse is
 * dearer, which is the one thing about it that is never news.
 *
 * A MISSING POINT IS A DISAGREEMENT, not a smaller sample. If four points read
 * 150 and the fifth has no price at all, this is a RANGE — because pressing the
 * button WOULD change something, and a bare number would say it would not. The
 * mock's `dayPrice` makes the same call for the same reason.
 *
 * Money is compared with `cmp` over the decimal strings. `Math.min` would route
 * every price through a binary float on its way to a screen that prints it, and
 * this project carries `numeric` end to end precisely so that never happens.
 */
export function dayPrice(
  prices: Record<string, SheetCell>,
  commonPointIds: readonly string[],
): DayPrice {
  const known: string[] = [];
  let missing = 0;

  for (const id of commonPointIds) {
    const cell = prices[id];
    if (cell === undefined) missing += 1;
    else known.push(cell.base_price);
  }

  if (known.length === 0) return null;

  let min = known[0];
  let max = known[0];
  for (const value of known) {
    if (cmp(value, min) < 0) min = value;
    if (cmp(value, max) > 0) max = value;
  }

  if (missing === 0 && cmp(min, max) === 0) return { common: min };
  return { min, max };
}
