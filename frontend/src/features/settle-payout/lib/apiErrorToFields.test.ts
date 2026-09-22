import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

/** ApiError(status, message, details?, code?, payload?, reason?) — built from the
 *  parts each case cares about so the test reads as the server response. */
const apiError = (init: { status: number; code?: string; details?: string[] }) =>
  new ApiError(init.status, 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  it('PAYOUT_EXCEEDS_DEBT lands on amount', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_EXCEEDS_DEBT' }));
    expect(out.fieldErrors).toEqual([
      { field: 'amount', messageKey: 'payout.errors.exceedsDebtServer' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('PAYOUT_EXCEEDS_CASH lands on amount', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_EXCEEDS_CASH' }));
    expect(out.fieldErrors).toEqual([
      { field: 'amount', messageKey: 'payout.errors.exceedsCash' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('PAYOUT_CODE_TAKEN has no field left to land on, so it banners', () => {
    const out = apiErrorToFields(apiError({ status: 409, code: 'PAYOUT_CODE_TAKEN' }));
    expect(out).toEqual({ fieldErrors: [], formErrorKey: 'payout.errors.failed' });
  });

  it('PAYOUT_AMOUNT_ZERO lands on amount', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'PAYOUT_AMOUNT_ZERO' }));
    expect(out.fieldErrors).toEqual([{ field: 'amount', messageKey: 'payout.errors.amountZero' }]);
    expect(out.formErrorKey).toBeNull();
  });

  it('NO_OPEN_SHIFT is a banner, not a field error', () => {
    const out = apiErrorToFields(apiError({ status: 409, code: 'NO_OPEN_SHIFT' }));
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('payout.errors.noOpenShift');
  });

  it('SUPPLIER_INACTIVE is a banner', () => {
    const out = apiErrorToFields(apiError({ status: 400, code: 'SUPPLIER_INACTIVE' }));
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('payout.errors.supplierInactive');
  });

  it('SHIFT_CLOSED is a banner', () => {
    const out = apiErrorToFields(apiError({ status: 403, code: 'SHIFT_CLOSED' }));
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('payout.errors.shiftClosed');
  });

  it('a code-less class-validator detail on amount maps to the amount format key', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: ['amount must be a decimal string with at most 2 decimal places'],
      }),
    );
    expect(out.fieldErrors).toEqual([
      { field: 'amount', messageKey: 'payout.errors.amountFormat' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('an unrecognised code and no usable detail falls back to the form-level banner', () => {
    const out = apiErrorToFields(apiError({ status: 500 }));
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('payout.errors.failed');
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network down'));
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('payout.errors.failed');
  });
});
