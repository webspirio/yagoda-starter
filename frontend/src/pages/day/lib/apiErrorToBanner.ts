import { apiErrorCode } from '@/shared/api';

/**
 * A failed shift verb becomes ONE banner key. Branch on the backend's machine
 * `code` (ShiftsService throws it on every 4xx it raises deliberately), never
 * on the human message — the message is Ukrainian-free English prose meant for
 * a log, and it changes without notice.
 *
 * Only the three states the operator can actually recover from get their own
 * line. The rest — `SHIFT_NOT_NEWEST`, `SHIFT_DAY_ALREADY_USED`, `OWNER_ONLY`,
 * `NO_COLLECTION_POINT`, and the code-less 404 an operator gets for another
 * point's shift — fall through to the generic failure: they are all "this
 * screen should not have offered you that button", i.e. a bug rather than a
 * choice, and a wrong-but-specific sentence would be worse than a plain one.
 */
const BY_CODE: Readonly<Record<string, string>> = {
  SHIFT_ALREADY_OPEN: 'day.errors.alreadyOpen',
  SHIFT_ALREADY_CLOSED: 'day.errors.notOpen',
  SHIFT_NOT_CLOSED: 'day.errors.notClosed',
};

/** Maps a failed open/close/reopen onto an i18n key for the page's banner. */
export function apiErrorToBanner(error: unknown): string {
  const code = apiErrorCode(error);
  return (code && BY_CODE[code]) ?? 'day.errors.failed';
}
