import { ApiError } from '@/shared/api';

export interface ApiFieldErrors {
  /** field name (RHF path, e.g. `items.0.gross_kg`) -> i18n message key */
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** i18n key for a form-level banner, or null */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'reception.errors.failed';

/**
 * Business-rule codes (`intakes.service.ts`, `intake-lines.ts`) that name
 * exactly one FIELD on the draft line. None of their messages carry a line
 * index today (read `intake-lines.ts` — every `bad(...)` call names the
 * grade/tare type/range, never "line N"), so every one of them lands on the
 * LAST line — the draft the operator is actively completing when the preview
 * or submit that surfaced it was in flight. `lineCount` is the caller's
 * `items.length` at the time of the request.
 */
const LINE_FIELD: Readonly<Record<string, { suffix: string; messageKey: string }>> = {
  GRADE_NOT_PRICED: { suffix: 'product_grade_id', messageKey: 'reception.errors.gradeNotPriced' },
  TARE_REQUIRED: { suffix: 'tare.0.tare_type_id', messageKey: 'reception.errors.tareRequired' },
  TARE_TYPE_DUPLICATED: {
    suffix: 'tare.0.tare_type_id',
    messageKey: 'reception.errors.tareTypeDuplicated',
  },
  TARE_TYPE_UNKNOWN: {
    suffix: 'tare.0.tare_type_id',
    messageKey: 'reception.errors.tareTypeUnknown',
  },
  BONUS_OUT_OF_RANGE: { suffix: 'bonus', messageKey: 'reception.errors.bonusOutOfRange' },
  NET_WEIGHT_NOT_POSITIVE: { suffix: 'gross_kg', messageKey: 'reception.errors.netNotPositive' },
};

/** Codes that name a top-level (non-line) form field. */
const TOP_FIELD: Readonly<Record<string, string>> = {
  INTAKE_CODE_TAKEN: 'reception.errors.codeTaken',
};

/** Codes that are refusals of the whole request, not one field. */
const BANNER: Readonly<Record<string, string>> = {
  NO_OPEN_SHIFT: 'reception.errors.noOpenShift',
  SUPPLIER_INACTIVE: 'reception.errors.supplierInactive',
  SHIFT_CLOSED: 'reception.errors.shiftClosed',
};

/**
 * class-validator emits `"<property> <complaint>"` for `CreateIntakeDto`'s
 * nested items — `items.0.gross_kg must be …`, `items.0.tare.1.units must
 * not be less than 1`. The PROPERTY (first token) IS the RHF field path
 * already, so no re-mapping is needed beyond taking it verbatim; every such
 * detail maps to the same `decimalFormat` key regardless of which nested
 * field it names (the class-validator complaint text is not stable enough to
 * branch on, and this slice has no other per-property message to show). A
 * detail naming anything outside `items.*` (e.g. a picked `supplier_id`) is
 * never something the operator typed here, so it is unplaceable and falls to
 * the form-level banner instead of a phantom field error.
 */
function fieldFromDetail(detail: string): string | null {
  const prop = detail.split(' ')[0];
  return prop.startsWith('items.') ? prop : null;
}

/**
 * Maps a failed preview/create-intake request onto RHF field errors (i18n
 * keys) + an optional form-level banner. `lineCount` is `items.length` for
 * the body that was sent, used to place a line-scoped business-rule code on
 * the last line. A detail that cannot be placed on a field becomes a banner
 * rather than vanishing silently; a non-`ApiError` (network, etc.) — or any
 * `ApiError` this mapper does not recognize — is a form-level failure.
 */
export function apiErrorToFields(error: unknown, lineCount: number): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  if (error.code) {
    const topKey = TOP_FIELD[error.code];
    if (topKey) return { fieldErrors: [{ field: 'code', messageKey: topKey }], formErrorKey: null };

    const line = LINE_FIELD[error.code];
    if (line) {
      const lastLine = Math.max(lineCount - 1, 0);
      return {
        fieldErrors: [{ field: `items.${lastLine}.${line.suffix}`, messageKey: line.messageKey }],
        formErrorKey: null,
      };
    }

    const banner = BANNER[error.code];
    if (banner) return { fieldErrors: [], formErrorKey: banner };

    return { fieldErrors: [], formErrorKey: FORM_LEVEL };
  }

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;
  for (const detail of error.details ?? []) {
    const field = fieldFromDetail(detail);
    if (field) fieldErrors.push({ field, messageKey: 'reception.errors.decimalFormat' });
    else unattributed = true;
  }
  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: FORM_LEVEL };
}
