import { ApiError } from '@/shared/api';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'suppliers.errors.saveFailed';

// machine-code suffix -> [field it lands on, message key]
const CODE_FIELD: ReadonlyArray<[suffix: string, field: string, messageKey: string]> = [
  ['_PHONE_TAKEN', 'phone', 'suppliers.errors.phoneTaken'],
  ['_PHONE_INVALID', 'phone', 'suppliers.errors.phoneInvalid'],
  ['_NAME_EMPTY', 'first_name', 'suppliers.errors.nameRequired'],
  // COLLECTION_POINT_REQUIRED — an owner who did not name a point.
  ['_POINT_REQUIRED', 'collection_point_id', 'suppliers.errors.pointRequired'],
];

// class-validator property (first token of each details string) -> message key
const PROPERTY: Readonly<Record<string, string>> = {
  first_name: 'suppliers.errors.nameRequired',
  last_name: 'suppliers.errors.nameRequired',
  phone: 'suppliers.errors.phoneInvalid',
};

/**
 * Maps a server error onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on `ApiError.code` first (both the friendly 409
 * `SUPPLIER_PHONE_TAKEN` and the 400 `SUPPLIER_PHONE_INVALID`/`_NAME_EMPTY`/
 * `COLLECTION_POINT_REQUIRED`), then on class-validator `details`. A code whose
 * target field is not on the form (e.g. the point on an operator's form)
 * degrades to a form-level banner rather than a lost error.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  const code = error.code;
  if (code) {
    const match = CODE_FIELD.find(([suffix]) => code.endsWith(suffix));
    if (match) {
      const [, field, messageKey] = match;
      if (fields.includes(field)) {
        return { fieldErrors: [{ field, messageKey }], formErrorKey: null };
      }
      return { fieldErrors: [], formErrorKey: FORM_LEVEL };
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
