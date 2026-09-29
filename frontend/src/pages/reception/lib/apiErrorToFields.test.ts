import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

/** ApiError(status, message, details?, code?, payload?, reason?) — built from
 *  the parts each case cares about so the test reads as the server response. */
const apiError = (init: { status: number; message?: string; code?: string; details?: string[] }) =>
  new ApiError(init.status, init.message ?? 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  it('INTAKE_CODE_TAKEN has no field left to land on, so it banners', () => {
    const out = apiErrorToFields(apiError({ status: 409, code: 'INTAKE_CODE_TAKEN' }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.failed');
  });

  it('maps GRADE_NOT_PRICED onto the last line’s product_grade_id', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'GRADE_NOT_PRICED' }), 3);
    expect(out.fieldErrors).toEqual([
      { field: 'items.2.product_grade_id', messageKey: 'reception.errors.gradeNotPriced' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps TARE_REQUIRED onto the last line’s first tare row', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'TARE_REQUIRED' }), 1);
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.tare.0.tare_type_id', messageKey: 'reception.errors.tareRequired' },
    ]);
  });

  it('maps TARE_TYPE_DUPLICATED onto the last line’s first tare row', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'TARE_TYPE_DUPLICATED' }), 2);
    expect(out.fieldErrors).toEqual([
      { field: 'items.1.tare.0.tare_type_id', messageKey: 'reception.errors.tareTypeDuplicated' },
    ]);
  });

  it('maps TARE_TYPE_UNKNOWN onto the last line’s first tare row', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'TARE_TYPE_UNKNOWN' }), 1);
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.tare.0.tare_type_id', messageKey: 'reception.errors.tareTypeUnknown' },
    ]);
  });

  it('maps BONUS_OUT_OF_RANGE onto the last line’s bonus', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'BONUS_OUT_OF_RANGE' }), 2);
    expect(out.fieldErrors).toEqual([
      { field: 'items.1.bonus', messageKey: 'reception.errors.bonusOutOfRange' },
    ]);
  });

  it('maps NET_WEIGHT_NOT_POSITIVE onto the last line’s gross_kg', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'NET_WEIGHT_NOT_POSITIVE' }), 1);
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.gross_kg', messageKey: 'reception.errors.netNotPositive' },
    ]);
  });

  it('maps NO_OPEN_SHIFT to a banner, with no field errors', () => {
    const out = apiErrorToFields(apiError({ status: 409, code: 'NO_OPEN_SHIFT' }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.noOpenShift');
  });

  // «З них наших ящиків» (2026-09-24) — each refuses the WHOLE receipt, and
  // none names a line: the returned-crates figure is one number on the form.
  it.each([
    ['RETURNED_EXCEEDS_TARE', 400, 'reception.returned.exceedsTare'],
    ['RETURN_EXCEEDS_OUTSTANDING', 400, 'crates.errors.returnExceeds'],
    ['CRATE_CASH_INSUFFICIENT', 409, 'crates.errors.cashInsufficient'],
  ])('maps %s to its banner', (code, status, key) => {
    const out = apiErrorToFields(apiError({ status, code }), 2);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe(key);
  });

  it('maps SUPPLIER_INACTIVE to a banner', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'SUPPLIER_INACTIVE' }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.supplierInactive');
  });

  it('maps SHIFT_CLOSED to a banner', () => {
    const out = apiErrorToFields(apiError({ status: 403, code: 'SHIFT_CLOSED' }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.shiftClosed');
  });

  it('maps a class-validator detail on a nested item field to decimalFormat', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: ['items.0.gross_kg must be a decimal string with at most 2 decimal places'],
      }),
      1,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.gross_kg', messageKey: 'reception.errors.decimalFormat' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a class-validator detail on a nested tare field to decimalFormat', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: ['items.0.tare.1.units must not be less than 1'],
      }),
      1,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.tare.1.units', messageKey: 'reception.errors.decimalFormat' },
    ]);
  });

  it('keeps a placeable detail but banners an unplaceable one alongside it', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'items.0.gross_kg must be a decimal string with at most 2 decimal places',
          'supplier_id must be a UUID',
        ],
      }),
      1,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'items.0.gross_kg', messageKey: 'reception.errors.decimalFormat' },
    ]);
    expect(out.formErrorKey).toBe('reception.errors.failed');
  });

  it('maps RATE_NEGATIVE onto the last line’s bonus', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'RATE_NEGATIVE' }), 2);
    expect(out.fieldErrors).toEqual([
      { field: 'items.1.bonus', messageKey: 'reception.errors.rateNegative' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('falls back to the form-level banner for a genuinely unknown code', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'SOME_FUTURE_CODE' }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.failed');
  });

  it('falls back to the form-level banner for a code-less, detail-less ApiError', () => {
    const out = apiErrorToFields(apiError({ status: 500 }), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.failed');
  });

  it('falls back to the form-level banner for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network down'), 1);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('reception.errors.failed');
  });

  it('maps PAYOUT_EXCEEDS_CASH onto paid_amount, not a line', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_EXCEEDS_CASH' }), 2);
    expect(out.fieldErrors).toEqual([
      { field: 'paid_amount', messageKey: 'reception.errors.paidExceedsCash' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps PAYOUT_EXCEEDS_DEBT onto paid_amount', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_EXCEEDS_DEBT' }), 1);
    expect(out.fieldErrors).toEqual([
      { field: 'paid_amount', messageKey: 'reception.errors.paidExceedsDebt' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps PAYOUT_AMOUNT_ZERO onto paid_amount — unreachable from this client, mapped anyway', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_AMOUNT_ZERO' }), 1);
    expect(out.fieldErrors).toEqual([
      { field: 'paid_amount', messageKey: 'reception.errors.paidFormat' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a class-validator detail on paid_amount to paidFormat, not decimalFormat', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: ['paid_amount must match /^\\d{1,10}(\\.\\d{1,2})?$/'],
      }),
      1,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'paid_amount', messageKey: 'reception.errors.paidFormat' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });
});
