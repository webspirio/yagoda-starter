/**
 * The `data-trace` ids of «Собівартість дня» (`shared/ui/trace`) — one place,
 * so a formula and the cell it cites can never spell one differently. Every id
 * is app-made: a product's uuid or a shift's, never user text.
 *
 * A row's own cells are `p:<productId>:<field>`; a point's sub-row under a
 * network product is `p:<productId>:pt:<shiftId>:<field>`. `day:` is a figure
 * of the whole day shown outside the table (the expenses strip, the доплати
 * chip) or repeated down a column (the two per-kg halves); `total:` is the
 * «Усього» row; `unweighed:` marks the cells the «не перезважено» line sums.
 */
export type RowField =
  | 'intakeKg'
  | 'baseKg'
  | 'shortKg'
  | 'accrued'
  | 'price'
  | 'shortfall'
  | 'shortfallPerKg'
  | 'expensesPerKg'
  | 'shortfallShare'
  | 'expensesShare'
  | 'full'
  | 'cost'
  | 'unweighedKg'
  | 'unweighedAccrued';

export const rowId = (productId: string, field: RowField) => `p:${productId}:${field}`;
export const pointRowId = (productId: string, shiftId: string, field: RowField) =>
  `p:${productId}:pt:${shiftId}:${field}`;
/** One point's day expenses in the «Усі точки» expenses line. */
export const pointExpensesId = (shiftId: string) => `pt:${shiftId}:expenses`;

export const DAY = {
  baseKg: 'day:baseKg',
  expenses: 'day:expenses',
  expensesPerKg: 'day:expensesPerKg',
  shortfallPerKg: 'day:shortfallPerKg',
  topUps: 'day:topUps',
} as const;

export const TOTAL = {
  intakeKg: 'total:intakeKg',
  shortKg: 'total:shortKg',
  accrued: 'total:accrued',
  shortfall: 'total:shortfall',
  shortfallShare: 'total:shortfallShare',
  expensesShare: 'total:expensesShare',
  full: 'total:full',
} as const;

export const UNWEIGHED = {
  intakeKg: 'unweighed:intakeKg',
  accrued: 'unweighed:accrued',
} as const;
