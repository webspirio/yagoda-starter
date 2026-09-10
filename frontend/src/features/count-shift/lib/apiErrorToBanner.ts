import { apiErrorCode } from '@/shared/api';

/**
 * A failed shift verb becomes ONE banner key. Branch on the backend's machine
 * `code` (ShiftsService throws it on every 4xx it raises deliberately), never
 * on the human message — the message is English prose meant for a log, and it
 * changes without notice.
 *
 * Every code `ShiftsService` throws is spelled out, because each one names a
 * DIFFERENT remedy: an open shift is closed, a used day is reopened, a
 * not-newest shift cannot be reopened at all, and the two 403s are "not you"
 * rather than "not now". Collapsing them would tell the operator to do the
 * wrong thing.
 *
 * The fallback still matters: the operator's 404 for another point's shift
 * carries NO code (`loadVisible` throws a bare NotFoundException, deliberately
 * hiding the other point's existence), and a future code lands here too.
 */
const BY_CODE: Readonly<Record<string, string>> = {
  SHIFT_ALREADY_OPEN: 'day.errors.alreadyOpen',
  SHIFT_ALREADY_CLOSED: 'day.errors.notOpen',
  SHIFT_NOT_CLOSED: 'day.errors.notClosed',
  SHIFT_DAY_ALREADY_USED: 'day.errors.dayAlreadyUsed',
  SHIFT_NOT_NEWEST: 'day.errors.notNewest',
  OWNER_ONLY: 'day.errors.ownerOnly',
  NO_COLLECTION_POINT: 'day.errors.noPoint',
};

/**
 * Maps a failed open/close/reopen onto an i18n key for a banner. The keys
 * stay under the `day.errors.*` namespace (unchanged by this module's move
 * into `features/count-shift`): the messages are generic shift-domain prose,
 * not Day-screen-specific, and `CountDrawerDialog` needs no new strings to
 * show them on `pages/reception` too. `ReopenShiftDialog` (`pages/day`,
 * reopen has one consumer and stays there) imports this via
 * `@/features/count-shift`.
 */
export function apiErrorToBanner(error: unknown): string {
  const code = apiErrorCode(error);
  return (code && BY_CODE[code]) ?? 'day.errors.failed';
}
