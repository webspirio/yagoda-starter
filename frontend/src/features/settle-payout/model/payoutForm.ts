/** RHF values for `PayoutDialog` — one field, because one is all that is left
 *  to type. The amount is normalised (trim, comma→dot) lazily at
 *  validate/submit time, so the control stays uncontrolled.
 *
 *  `code` LEFT ON 2026-09-18. It was the number off the paper payout book; the
 *  server numbers the shift itself now, so there is nothing to collect and
 *  nothing to validate. */
export interface PayoutFormValues {
  amount: string;
}
