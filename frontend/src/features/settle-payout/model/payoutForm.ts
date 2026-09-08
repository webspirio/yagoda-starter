/** RHF values for `PayoutDialog` — both fields are strings the operator typed;
 *  normalisation (trim, upper-case the code, comma→dot the amount) happens at
 *  submit time, not on every keystroke, so the control stays uncontrolled. */
export interface PayoutFormValues {
  code: string;
  amount: string;
}
