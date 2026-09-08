/**
 * Mirrors the backend's typed-receipt-number rule (shared by intakes and
 * payouts — see `features/settle-payout/ui/PayoutDialog.tsx`'s `CODE`):
 * 1–16 chars, upper-cased, first char alphanumeric so a document can never
 * start with a bare dash. The server does not itself validate this shape
 * (`CreateIntakeDto.code` is `@IsString()` only — it composes the stored
 * code around whatever was typed), so this is the only place the rule is
 * enforced; getting it wrong client-side does not risk a mismatched 400.
 */
const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/** Trims and upper-cases a typed receipt number — the normalisation applied
 *  before both validating it and sending it on the wire. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Whether a typed receipt number is valid once normalized. */
export function isValidCode(raw: string): boolean {
  return CODE.test(normalizeCode(raw));
}
