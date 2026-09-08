import { ApiError } from '@/shared/api';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'catalog.errors.saveFailed';

/**
 * The three catalog services each prefix their codes with their own resource
 * name (`PRODUCT_`, `GRADE_`, `TARE_TYPE_`), so match the SUFFIX. Matching whole
 * codes would need nine entries and would silently miss a fourth resource.
 */
const CODE_SUFFIX: ReadonlyArray<[string, string]> = [
  ['_NAME_TAKEN', 'catalog.errors.nameTaken'],
  ['_NAME_EMPTY', 'catalog.errors.nameEmpty'],
];

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
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    const match = CODE_SUFFIX.find(([suffix]) => error.code!.endsWith(suffix));
    if (match && fields.includes('name')) {
      return { fieldErrors: [{ field: 'name', messageKey: match[1] }], formErrorKey: null };
    }
  }

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
