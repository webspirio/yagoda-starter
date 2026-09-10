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
  // Cash & transfers slice (#62). `TransfersService.transition` refuses an
  // accept/dispute with no open shift at the point: `accepted_date` is taken
  // from the shift (§4.2), so a transfer accepted outside one belongs to no
  // shift's arithmetic. OWNER_ONLY above already covers resolving a dispute
  // (`TransfersService.resolve`, the same shared code) and ALREADY_VOIDED
  // already covers double-voiding a transfer — voiding an ACCEPTED transfer
  // is not an error at all (§9.3's correction path: void, then a new
  // document), so it needs no entry here.
  NO_OPEN_SHIFT: 'transfer.errors.noOpenShift',
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
  return (code && CODE[code]) ?? fallback;
}
