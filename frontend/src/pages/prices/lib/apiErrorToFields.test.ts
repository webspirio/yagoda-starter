import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = ['base_price', 'max_markup', 'max_discount'] as const;

/** ApiError(status, message, details?, code?, payload?, reason?) — built from the
 *  parts each case cares about so the test reads as the server response. */
const apiError = (init: { status: number; code?: string; details?: string[] }) =>
  new ApiError(init.status, 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  it('maps each money property onto its field by the leading token', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'base_price must be a decimal string with at most 2 decimal places',
          'max_markup must be a decimal string with at most 2 decimal places',
          'max_discount must be a decimal string with at most 2 decimal places',
        ],
      }),
      FIELDS,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'base_price', messageKey: 'prices.errors.priceFormat' },
      { field: 'max_markup', messageKey: 'prices.errors.priceFormat' },
      { field: 'max_discount', messageKey: 'prices.errors.priceFormat' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('keeps a placeable field error but banners an unplaceable detail alongside it', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'base_price must be a decimal string with at most 2 decimal places',
          'collection_point_id must be a UUID',
        ],
      }),
      FIELDS,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'base_price', messageKey: 'prices.errors.priceFormat' },
    ]);
    expect(out.formErrorKey).toBe('prices.errors.saveFailed');
  });

  it('sends a detail naming an unknown property to the form level', () => {
    const out = apiErrorToFields(
      apiError({ status: 400, details: ['product_grade_id must be a UUID'] }),
      FIELDS,
    );
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('prices.errors.saveFailed');
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network down'), FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('prices.errors.saveFailed');
  });
});
