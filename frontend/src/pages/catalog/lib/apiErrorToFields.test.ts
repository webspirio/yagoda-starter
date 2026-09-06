import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = ['name', 'weight_kg', 'deposit_price'] as const;

/** ApiError's constructor is exercised through a helper so each test reads as
 *  the server response it stands for, not as constructor plumbing. */
const apiError = (init: { status: number; code?: string; details?: string[] }) =>
  // Verified signature: ApiError(status, message, details?, code?, payload?, reason?)
  new ApiError(init.status, 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  it('puts a 409 name conflict on the name field, not in the banner', () => {
    const result = apiErrorToFields(apiError({ status: 409, code: 'PRODUCT_NAME_TAKEN' }), FIELDS);
    expect(result.fieldErrors).toEqual([{ field: 'name', messageKey: 'catalog.errors.nameTaken' }]);
    expect(result.formErrorKey).toBeNull();
  });

  // The three services use three different prefixes for the same condition.
  it.each(['PRODUCT_NAME_TAKEN', 'GRADE_NAME_TAKEN', 'TARE_TYPE_NAME_TAKEN'])(
    'recognises %s',
    (code) => {
      const result = apiErrorToFields(apiError({ status: 409, code }), FIELDS);
      expect(result.fieldErrors[0]).toEqual({
        field: 'name',
        messageKey: 'catalog.errors.nameTaken',
      });
    },
  );

  it.each(['PRODUCT_NAME_EMPTY', 'GRADE_NAME_EMPTY', 'TARE_TYPE_NAME_EMPTY'])(
    'recognises %s',
    (code) => {
      const result = apiErrorToFields(apiError({ status: 400, code }), FIELDS);
      expect(result.fieldErrors[0]).toEqual({
        field: 'name',
        messageKey: 'catalog.errors.nameEmpty',
      });
    },
  );

  // class-validator emits "<property> <complaint>" strings; the property is the
  // first token. This is what ApiError.details exists to carry.
  it('maps class-validator details onto fields by their leading property name', () => {
    const result = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'weight_kg must be a decimal string with at most 2 decimal places',
          'name must be shorter than or equal to 128 characters',
        ],
      }),
      FIELDS,
    );
    expect(result.fieldErrors).toEqual([
      { field: 'weight_kg', messageKey: 'catalog.errors.weightFormat' },
      { field: 'name', messageKey: 'catalog.errors.nameTooLong' },
    ]);
    expect(result.formErrorKey).toBeNull();
  });

  it('sends a detail naming an unknown property to the form level', () => {
    const result = apiErrorToFields(
      apiError({ status: 400, details: ['collection_point_id must be a UUID'] }),
      FIELDS,
    );
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });

  it('sends an unrecognised failure to the form level', () => {
    const result = apiErrorToFields(apiError({ status: 500 }), FIELDS);
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });

  it('handles something that is not an ApiError at all', () => {
    const result = apiErrorToFields(new Error('network down'), FIELDS);
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });
});
