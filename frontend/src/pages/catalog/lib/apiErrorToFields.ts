import { ApiError } from '@/shared/api';
import { statusKey } from '@/shared/lib/api-error';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'catalog.errors.saveFailed';

// Each service prefixes its own codes; exact entries, so a stray code never matches.
const CODE_KEY: Readonly<Record<string, string>> = {
  GRADE_NAME_TAKEN: 'catalog.errors.nameTaken',
  PRODUCT_NAME_TAKEN: 'catalog.errors.nameTaken',
  TARE_TYPE_NAME_TAKEN: 'catalog.errors.nameTaken',
  GRADE_NAME_EMPTY: 'catalog.errors.nameEmpty',
  PRODUCT_NAME_EMPTY: 'catalog.errors.nameEmpty',
  TARE_TYPE_NAME_EMPTY: 'catalog.errors.nameEmpty',
};

/**
 * class-validator emits `"<property> <complaint>"`. The complaint text is not
 * stable enough to match on, so map the PROPERTY (first token) to the one rule
 * that property can fail beyond presence in these forms.
 */
const PROPERTY: Readonly<Record<string, string>> = {
  name: 'catalog.errors.nameTooLong',
  weight_kg: 'catalog.errors.weightFormat',
  deposit_price: 'catalog.errors.depositFormat',
};

/**
 * Maps a failed catalog mutation onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on the machine-readable `ApiError.code` first (a
 * name clash lands on the `name` field), then on class-validator `details`. A
 * detail that cannot be placed becomes a banner rather than vanishing silently.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: statusKey(error) ?? FORM_LEVEL };

  const key = error.code ? CODE_KEY[error.code] : undefined;
  if (key && fields.includes('name')) {
    return { fieldErrors: [{ field: 'name', messageKey: key }], formErrorKey: null };
  }

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;
  for (const detail of error.details ?? []) {
    const prop = detail.split(' ')[0];
    const propKey = PROPERTY[prop];
    if (propKey && fields.includes(prop)) fieldErrors.push({ field: prop, messageKey: propKey });
    else unattributed = true;
  }
  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: statusKey(error) ?? FORM_LEVEL };
}
