import { ApiError } from '@/shared/api';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'prices.errors.saveFailed';

/**
 * class-validator emits `"<property> <complaint>"`. The complaint text is not
 * stable enough to match on, so map the PROPERTY (first token) to its message.
 * All three money fields fail the same `@Matches` rule, so they share one
 * message key. The point/grade uuids also validate server-side, but a bad uuid
 * is never something the owner typed here (both come from picked rows), so those
 * fall through to the form-level banner rather than a phantom field error.
 */
const PROPERTY: Readonly<Record<string, string>> = {
  base_price: 'prices.errors.priceFormat',
  max_markup: 'prices.errors.priceFormat',
  max_discount: 'prices.errors.priceFormat',
};

/**
 * Maps a failed set-price mutation onto RHF field errors (i18n keys) + an
 * optional form-level banner. A `details` entry that cannot be placed on a field
 * becomes a banner rather than vanishing silently; a non-ApiError (network, etc.)
 * is a form-level failure.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;
  for (const detail of error.details ?? []) {
    const prop = detail.split(' ')[0];
    const key = PROPERTY[prop];
    if (key && fields.includes(prop)) fieldErrors.push({ field: prop, messageKey: key });
    else unattributed = true;
  }
  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: FORM_LEVEL };
}
