import { ApiError } from '@/shared/api';

const FORM_LEVEL = 'void.errors.failed';

/**
 * class-validator/business-rule codes the void endpoints can return, mapped
 * to their i18n banner key. Anything else — an unrecognised code, or no code
 * at all (a network failure, a 500, …) — falls back to `FORM_LEVEL`.
 */
const CODE: Readonly<Record<string, string>> = {
  NOT_YOUR_DOCUMENT: 'void.errors.notYourDocument',
  SHIFT_CLOSED: 'void.errors.shiftClosed',
  ALREADY_VOIDED: 'void.errors.alreadyVoided',
};

/** Maps a failed void mutation onto an i18n key for the dialog's banner. */
export function apiErrorToBanner(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    return CODE[error.code] ?? FORM_LEVEL;
  }
  return FORM_LEVEL;
}
