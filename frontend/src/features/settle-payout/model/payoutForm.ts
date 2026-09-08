/** RHF values for `PayoutDialog` — both fields are strings the operator typed.
 *  The code is upper-cased live in the input; the amount is normalised (trim,
 *  comma→dot) lazily at validate/submit time, so the amount control stays
 *  uncontrolled. */
export interface PayoutFormValues {
  code: string;
  amount: string;
}
