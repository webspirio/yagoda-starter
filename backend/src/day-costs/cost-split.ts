/**
 * §8.5 — how the day's basket (недостача + витрати) is split between the
 * products weighed in full (spec 2026-10-24 §2). A VIEW of the day, never its
 * state: nothing is stored, and the day's sums are the same under all three.
 *
 * - `weight` — by «наша вага», the default and the only way before 2026-10-24.
 * - `value`  — both parts by «нараховано» (доплати included).
 * - `own`    — each product keeps its own недостача; витрати by «нараховано».
 */
export const COST_SPLITS = ['weight', 'value', 'own'] as const;

export type CostSplit = (typeof COST_SPLITS)[number];
