import { ApiError } from '@/shared/api';

export interface ApiFieldErrors {
  /** field name -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'users.errors.saveFailed';

// class-validator property (first token of each details string) -> message key
const PROPERTY: Readonly<Record<string, string>> = {
  first_name: 'users.errors.nameRequired',
  last_name: 'users.errors.nameRequired',
  login: 'users.errors.loginRequired',
  password: 'users.errors.passwordShort',
  role: FORM_LEVEL,
};

/**
 * Maps a server error onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on `ApiError.code` first (owner-facing conflict
 * codes), then on class-validator `details`. A login clash lands on the `login`
 * field; a `_HAS_ACTIVE_*` state conflict (e.g. deactivating a user with an
 * open shift) is a banner, not a field. A whitespace-in-login validation
 * message routes to its own key.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    if (error.code.endsWith('_LOGIN_TAKEN') && fields.includes('login')) {
      return {
        fieldErrors: [{ field: 'login', messageKey: 'users.errors.loginTaken' }],
        formErrorKey: null,
      };
    }
    // A state conflict (assigned/active dependents) is not a field problem.
    if (error.code.includes('_HAS_ACTIVE')) {
      return { fieldErrors: [], formErrorKey: FORM_LEVEL };
    }
  }

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;
  for (const detail of error.details ?? []) {
    const prop = detail.split(' ')[0];
    let key = PROPERTY[prop];
    if (prop === 'login' && /whitespace/i.test(detail)) key = 'users.errors.loginWhitespace';
    if (key && fields.includes(prop)) fieldErrors.push({ field: prop, messageKey: key });
    else unattributed = true;
  }
  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: FORM_LEVEL };
}
