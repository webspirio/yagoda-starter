/**
 * Trace ids of the reception form («звідки це число», client 24.10). The page puts
 * ONE `TraceScope` around the form, so the draft line's formula (`LineEditor`) and
 * the settlement card (`TotalsSection`) light each other up: each operand of the
 * line's formula points at the field it was typed into, the line's amount at
 * «Нараховано сьогодні», and every derived figure of the card at the rows it is
 * made of.
 */
export const DRAFT_TRACE = {
  gross: 'd:gross',
  pallet: 'd:pallet',
  tare: 'd:tare',
  net: 'd:net',
  price: 'd:price',
  exact: 'd:exact',
} as const;

/** «Нараховано сьогодні» — what the draft line's amount is part of. */
export const ACCRUED_TRACE = 'total:accrued';

/**
 * The settlement card's derived figures, each citing its rows under ids of its own
 * (`sum:` «Разом», `new:` the debt this delivery adds, `old:` what it pays down,
 * `rem:` the remainder). A term lights EVERY element listing one of its ids, other
 * terms included, so two results sharing an operand under one id would light each
 * other up; one namespace per result keeps each pointing at its own rows only.
 */
export const TOTALS_TRACE = {
  sum: { accrued: 'sum:accrued', debt: 'sum:debt' },
  newDebt: { accrued: 'new:accrued', paid: 'new:paid', debt: 'new:debt' },
  paysOld: { paid: 'old:paid', accrued: 'old:accrued' },
  remainder: { total: 'rem:total', paid: 'rem:paid' },
} as const;

/** The `data-trace` of each row the card's results read. */
export const TOTALS_SOURCE = {
  accrued: [
    ACCRUED_TRACE,
    TOTALS_TRACE.sum.accrued,
    TOTALS_TRACE.newDebt.accrued,
    TOTALS_TRACE.paysOld.accrued,
  ].join(' '),
  debt: [TOTALS_TRACE.sum.debt, TOTALS_TRACE.newDebt.debt].join(' '),
  total: TOTALS_TRACE.remainder.total,
  paid: [TOTALS_TRACE.remainder.paid, TOTALS_TRACE.newDebt.paid, TOTALS_TRACE.paysOld.paid].join(
    ' ',
  ),
} as const;
