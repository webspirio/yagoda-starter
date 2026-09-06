import { ApiError } from '@/shared/api';

/**
 * Turns a failed catalog mutation into per-field form errors.
 *
 * This exists because TWO of the backend's rules cannot be checked on the
 * client at all: "that name is taken" is a `lower(name)` index lookup, and for
 * a grade it is scoped per product. The client cannot know either without
 * asking, so the server's answer has to land under the offending input rather
 * than in a banner the user must map onto a field themselves.
 *
 * Returned rather than applied: the caller owns the form, and a pure function
 * is testable without rendering one.
 *
 * Every `messageKey` is an i18n KEY, not a message — `Field` resolves it with
 * `t()` internally, so handing it a human string would render that string as a
 * missing key.
 *
 * Kept page-local rather than in `shared/lib`: three dialogs use it, but all
 * three are one page, and FSD's threshold is multiple *places*. It moves to
 * `shared/lib/` the moment the users or points screen needs it.
 */
export interface ApiFieldErrors {
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** Non-null when something could not be attributed to a field. */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'catalog.errors.saveFailed';

/**
 * The three catalog services each prefix their codes with their own resource
 * name (`PRODUCT_`, `GRADE_`, `TARE_TYPE_`), so match the SUFFIX. Matching
 * whole codes would need nine entries and would silently miss the fourth
 * resource the next slice adds.
 */
const CODE_SUFFIX_TO_MESSAGE: ReadonlyArray<[string, string]> = [
  ['_NAME_TAKEN', 'catalog.errors.nameTaken'],
  ['_NAME_EMPTY', 'catalog.errors.nameEmpty'],
];

/**
 * class-validator emits `"<property> <complaint>"`. The complaint text is not
 * stable enough to match on, so this maps the PROPERTY to the one message that
 * property can fail with in these forms — each field has exactly one rule the
 * server enforces beyond presence.
 */
const PROPERTY_TO_MESSAGE: Readonly<Record<string, string>> = {
  name: 'catalog.errors.nameTooLong',
  weight_kg: 'catalog.errors.weightFormat',
  deposit_price: 'catalog.errors.depositFormat',
};

export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  // Branch on the machine-readable code first, never on the human message —
  // the same convention LoginForm follows.
  if (error.code) {
    const matched = CODE_SUFFIX_TO_MESSAGE.find(([suffix]) => error.code!.endsWith(suffix));
    if (matched && fields.includes('name')) {
      return { fieldErrors: [{ field: 'name', messageKey: matched[1] }], formErrorKey: null };
    }
  }

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;

  for (const detail of error.details ?? []) {
    // The property is the first token; class-validator always leads with it.
    const property = detail.split(' ')[0];
    const messageKey = PROPERTY_TO_MESSAGE[property];
    if (messageKey && fields.includes(property)) {
      fieldErrors.push({ field: property, messageKey });
    } else {
      // A detail we cannot place must NOT vanish. Silently dropping it would
      // leave the dialog looking like the save succeeded quietly.
      unattributed = true;
    }
  }

  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: FORM_LEVEL };
}
