import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = ['name', 'product_id', 'weight_kg', 'deposit_price'] as const;

/** ApiError(status, message, details?, code?, payload?, reason?) — build one from
 *  the parts each case cares about so the test reads as the server response. */
const apiError = (init: { status: number; code?: string; details?: string[] }) =>
  new ApiError(init.status, 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  // The three services use three different prefixes for the same condition.
  it.each(['PRODUCT_NAME_TAKEN', 'GRADE_NAME_TAKEN', 'TARE_TYPE_NAME_TAKEN'])(
    'puts a %s conflict on the name field, not in the banner',
    (code) => {
      const out = apiErrorToFields(apiError({ status: 409, code }), FIELDS);
      expect(out.fieldErrors).toEqual([{ field: 'name', messageKey: 'catalog.errors.nameTaken' }]);
      expect(out.formErrorKey).toBeNull();
    },
  );

  it.each(['PRODUCT_NAME_EMPTY', 'GRADE_NAME_EMPTY', 'TARE_TYPE_NAME_EMPTY'])(
    'maps %s onto the name field',
    (code) => {
      const out = apiErrorToFields(apiError({ status: 400, code }), FIELDS);
      expect(out.fieldErrors[0]).toEqual({ field: 'name', messageKey: 'catalog.errors.nameEmpty' });
    },
  );

  it('maps class-validator details onto fields by their leading property', () => {
    const out = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'weight_kg must be a decimal string with at most 2 decimal places',
          'name must be shorter than or equal to 128 characters',
        ],
      }),
      FIELDS,
    );
    expect(out.fieldErrors).toEqual([
      { field: 'weight_kg', messageKey: 'catalog.errors.weightFormat' },
      { field: 'name', messageKey: 'catalog.errors.nameTooLong' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('sends a detail naming an unknown property to the form level', () => {
    const out = apiErrorToFields(
      apiError({ status: 400, details: ['collection_point_id must be a UUID'] }),
      FIELDS,
    );
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('catalog.errors.saveFailed');
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network down'), FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('catalog.errors.saveFailed');
  });
});
