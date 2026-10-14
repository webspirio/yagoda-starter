import { ApiError } from '@/shared/api';
import { statusKey } from '@/shared/lib/api-error';

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

// exact backend code -> field it lands on; off-form it degrades to a banner
const CODE_FIELD: Readonly<Record<string, { field: string; messageKey: string }>> = {
  LOGIN_TAKEN: { field: 'login', messageKey: 'users.errors.loginTaken' },
  OPERATOR_NEEDS_POINT: { field: 'collection_point_id', messageKey: 'users.errors.pointRequired' },
};

// exact backend code -> banner (state conflicts, not field problems)
const CODE_BANNER: Readonly<Record<string, string>> = {
  LAST_OWNER: 'users.errors.lastOwner',
  SELF_LOCKOUT: 'users.errors.selfLockout',
  OWNER_HAS_NO_POINT: 'users.errors.ownerHasNoPoint',
  POINT_UNUSABLE: 'users.errors.pointUnusable',
  USER_NAME_EMPTY: 'users.errors.nameRequired',
};

/**
 * Maps a server error onto RHF field errors (i18n keys) + an optional
 * form-level banner. Branches on `ApiError.code` first (owner-facing conflict
 * codes, matched exactly), then on class-validator `details`. A login clash lands
 * on the `login` field; owner/point state conflicts are banners, not fields. A
 * whitespace-in-login validation message routes to its own key. An unexplained
 * failure gets the shared status sentence, else the generic banner.
 */
export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    const field = CODE_FIELD[error.code];
    if (field && fields.includes(field.field)) return { fieldErrors: [field], formErrorKey: null };
    const banner = CODE_BANNER[error.code] ?? field?.messageKey;
    if (banner) return { fieldErrors: [], formErrorKey: banner };
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
  return { fieldErrors: [], formErrorKey: statusKey(error) ?? FORM_LEVEL };
}
