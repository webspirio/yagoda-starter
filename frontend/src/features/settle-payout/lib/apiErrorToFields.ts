import { ApiError } from '@/shared/api';
import { statusKey } from '@/shared/lib/api-error';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'payout.errors.failed';

/**
 * `POST /payouts` (`payouts.service.ts`) attaches a machine-readable `code`
 * to every business-rule refusal, and each code names exactly one field —
 * unlike `prices`' class-validator `details` array, where one message key
 * covers three interchangeable money fields, there is no allowlist to thread
 * through here. `PAYOUT_EXCEEDS_DEBT`'s server message names the actual
 * debt, but `Field` only ever calls `t(key)` with no interpolation options,
 * so the field shows the static `exceedsDebtServer` copy rather than the
 * server's sentence — the client has already re-derived and shown the same
 * debt itself via the `cmp` check before the request was even sent.
 */
const CODE_FIELD: Readonly<Record<string, { field: string; messageKey: string }>> = {
  PAYOUT_EXCEEDS_DEBT: { field: 'amount', messageKey: 'payout.errors.exceedsDebtServer' },
  PAYOUT_AMOUNT_ZERO: { field: 'amount', messageKey: 'payout.errors.amountZero' },
  PAYOUT_EXCEEDS_CASH: { field: 'amount', messageKey: 'payout.errors.exceedsCash' },
};

const CODE_BANNER: Readonly<Record<string, string>> = {
  NO_OPEN_SHIFT: 'payout.errors.noOpenShift',
  SUPPLIER_INACTIVE: 'payout.errors.supplierInactive',
  SHIFT_CLOSED: 'payout.errors.shiftClosed',
  PAYOUT_CODE_TAKEN: 'errors.documentRace',
};

/**
 * Maps a failed create-payout mutation onto RHF field errors (i18n keys) + an
 * optional form-level banner. Server `code`s are checked first, since each
 * names exactly one outcome; a code-less 400 falls back to class-validator
 * `details` — today only `amount`'s `@Matches` can fail that way, since it is
 * the only field the request still carries.
 *
 * `PAYOUT_CODE_TAKEN` is generated server-side, so a collision is a race and
 * the advice is to press again.
 *
 * Anything else, including a non-ApiError (network, etc.), is a form-level
 * failure.
 */
export function apiErrorToFields(error: unknown): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    const field = CODE_FIELD[error.code];
    if (field) return { fieldErrors: [field], formErrorKey: null };

    const banner = CODE_BANNER[error.code];
    if (banner) return { fieldErrors: [], formErrorKey: banner };
  }

  for (const detail of error.details ?? []) {
    if (detail.split(' ')[0] === 'amount') {
      return {
        fieldErrors: [{ field: 'amount', messageKey: 'payout.errors.amountFormat' }],
        formErrorKey: null,
      };
    }
  }

  return { fieldErrors: [], formErrorKey: statusKey(error) ?? FORM_LEVEL };
}
