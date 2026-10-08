import { ApiError } from '@/shared/api';
import { statusKey } from '@/shared/lib/api-error';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'suppliers.errors.saveFailed';

// exact backend code -> [field it lands on, message key]
const CODE_FIELD: Readonly<Record<string, readonly [field: string, messageKey: string]>> = {
  SUPPLIER_PHONE_TAKEN: ['phone', 'suppliers.errors.phoneTaken'],
  SUPPLIER_PHONE_INVALID: ['phone', 'suppliers.errors.phoneInvalid'],
  SUPPLIER_NAME_EMPTY: ['first_name', 'suppliers.errors.nameRequired'],
  // an owner who did not name a point
  COLLECTION_POINT_REQUIRED: ['collection_point_id', 'suppliers.errors.pointRequired'],
};

// class-validator property (first token of each details string) -> message key
const PROPERTY: Readonly<Record<string, string>> = {
  first_name: 'suppliers.errors.nameRequired',
  last_name: 'suppliers.errors.nameRequired',
  phone: 'suppliers.errors.phoneInvalid',
};

/**
 * Maps a server error onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on `ApiError.code` (matched exactly) first (both the friendly 409
 * `SUPPLIER_PHONE_TAKEN` and the 400 `SUPPLIER_PHONE_INVALID`/`_NAME_EMPTY`/
 * `COLLECTION_POINT_REQUIRED`), then on class-validator `details`. A code whose
 * target field is not on the form (e.g. the point on an operator's form)
 * degrades to a form-level banner rather than a lost error.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  const code = error.code;
  if (code) {
    const match = CODE_FIELD[code];
    if (match) {
      const [field, messageKey] = match;
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
  return { fieldErrors: [], formErrorKey: statusKey(error) ?? FORM_LEVEL };
}
