import { ApiError } from '@/shared/api';
import { statusKey } from '@/shared/lib/api-error';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'points.errors.saveFailed';

// exact backend code -> [field it lands on (null = banner), message key]
const CODE_FIELD: Readonly<Record<string, readonly [field: string | null, messageKey: string]>> = {
  POINT_NAME_TAKEN: ['name', 'points.errors.nameTaken'],
  POINT_NAME_EMPTY: ['name', 'points.errors.nameEmpty'],
  POINT_CODE_TAKEN: ['code', 'points.errors.codeTaken'],
  // a state conflict, not a field problem
  POINT_HAS_ACTIVE_USERS: [null, 'points.errors.hasActiveUsers'],
};

// class-validator property (first token of each details string) -> message key
const PROPERTY: Readonly<Record<string, string>> = {
  name: 'points.errors.nameInvalid',
  code: 'points.errors.codeFormat',
  target_cash: 'points.errors.cashFormat',
  target_crates: 'points.errors.cratesFormat',
};

/**
 * Maps a server error onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on `ApiError.code` first (owner-facing conflict
 * codes, matched exactly), then on class-validator `details`. A name clash lands on the `name`
 * field; a deactivation conflict is a banner (not a field).
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    const match = CODE_FIELD[error.code];
    if (match) {
      const [field, key] = match;
      if (field && fields.includes(field)) {
        return { fieldErrors: [{ field, messageKey: key }], formErrorKey: null };
      }
      return { fieldErrors: [], formErrorKey: key };
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
