import { apiErrorCode } from '@/shared/api';

/**
 * Business-rule codes across every screen that maps a failed mutation onto a
 * banner, keyed by the backend's machine `code` — never by the human-readable
 * `message`, which is English prose meant for a log and changes without
 * notice. One entry per code, shared by every consumer: the backend hands
 * `OWNER_ONLY` out from more than one endpoint (shifts, payouts, transfers),
 * and a single mapping keeps its wording consistent everywhere it appears.
 *
 * NAMESPACES ARE HISTORICAL, not a filing scheme to keep tidy. This module
 * merges what used to be two copies — `features/void-document/lib` and
 * `features/count-shift/lib` (formerly `pages/day/lib`) — and keeps their
 * `void.errors.*` / `day.errors.*` key names exactly as they were: renaming
 * them would churn locale entries nobody asked to change for a refactor that
 * is only about where the code lives.
 */
const CODE: Readonly<Record<string, string>> = {
  // features/void-document
  NOT_YOUR_DOCUMENT: 'void.errors.notYourDocument',
  SHIFT_CLOSED: 'void.errors.shiftClosed',
  ALREADY_VOIDED: 'void.errors.alreadyVoided',
  // features/count-shift
  SHIFT_ALREADY_OPEN: 'day.errors.alreadyOpen',
  SHIFT_ALREADY_CLOSED: 'day.errors.notOpen',
  SHIFT_NOT_CLOSED: 'day.errors.notClosed',
  SHIFT_DAY_ALREADY_USED: 'day.errors.dayAlreadyUsed',
  SHIFT_NOT_NEWEST: 'day.errors.notNewest',
  OWNER_ONLY: 'day.errors.ownerOnly',
  NO_COLLECTION_POINT: 'day.errors.noPoint',
  // Cash & transfers slice (#62), owned by the send/receive/resolve-transfer
  // screens (Tasks 12-14). `TransfersService.transition` (accept/dispute,
  // POINT OPERATOR ONLY — §10.3) refuses:
  //  · no open shift at the point — `accepted_date` is taken from the shift
  //    (§4.1), so a transfer accepted outside one belongs to no shift's
  //    arithmetic;
  //  · the wrong actor — an owner may not press either button;
  //  · a voided transfer — voiding cancels the delivery, so there is nothing
  //    left to sign for;
  //  · a transfer that already has an answer — one accept-or-dispute per
  //    delivery, ever.
  // `TransfersService.resolve` (OWNER ONLY, the same shared `OWNER_ONLY`
  // above) refuses a transfer that isn't disputed, and a dispute already
  // resolved. `TransfersService.create` (OWNER ONLY) refuses a deactivated
  // point and a correction naming a transfer at a DIFFERENT point — the one
  // cross-point write this table's shape permits and must not permit in
  // fact. `ALREADY_VOIDED` (double-voiding a transfer, via `void`) already
  // has an entry above, shared with intakes/payouts.
  NO_OPEN_SHIFT: 'transfer.errors.noOpenShift',
  POINT_OPERATOR_ONLY: 'transfer.errors.pointOperatorOnly',
  TRANSFER_VOIDED: 'transfer.errors.voided',
  TRANSFER_ALREADY_ANSWERED: 'transfer.errors.alreadyAnswered',
  TRANSFER_NOT_DISPUTED: 'transfer.errors.notDisputed',
  TRANSFER_ALREADY_RESOLVED: 'transfer.errors.alreadyResolved',
  POINT_INACTIVE: 'transfer.errors.pointInactive',
  CORRECTION_POINT_MISMATCH: 'transfer.errors.correctionPointMismatch',
  // Crates (#57-#60; backend in the slice this branch sits on). `SHIFT_CLOSED`,
  // `NO_OPEN_SHIFT` and `ALREADY_VOIDED` already have entries above and are
  // shared verbatim — a crate document is refused by the same §9.4 rules as any
  // other, and a second wording for one code is exactly what this module exists
  // to prevent.
  NO_CRATE_TYPE: 'crates.errors.noCrateType',
  RETURN_EXCEEDS_OUTSTANDING: 'crates.errors.returnExceeds',
  CRATE_CASH_INSUFFICIENT: 'crates.errors.cashInsufficient',
  ISSUANCE_HAS_RETURNS: 'crates.errors.hasReturns',
  SUPPLIER_INACTIVE: 'crates.errors.supplierInactive',
};

/**
 * Maps a failed mutation onto an i18n key for a form-level banner.
 *
 * `fallback` is the caller's OWN generic "that failed" key, used for a code
 * this map has never seen — or no code at all (a network failure, a 500, or
 * a 404 that deliberately carries none, e.g. an operator probing another
 * point's document). It is a required argument, not a shared default: "the
 * shift couldn't be changed" and "couldn't void that" are different
 * sentences even when neither has a more specific cause to report, and the
 * whole point of this helper is to explain the cause rather than fall back
 * to something as generic as `common.somethingWentWrong`.
 */
export function apiErrorToBanner(error: unknown, fallback: string): string {
  const code = apiErrorCode(error);
  return code ? (CODE[code] ?? fallback) : fallback;
}
