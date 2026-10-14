import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'note',
  'kind',
  'collection_point_id',
  'is_active',
];

describe('apiErrorToFields', () => {
  it('maps a phone-taken code onto the phone field', () => {
    const err = new ApiError(409, 'taken', undefined, 'SUPPLIER_PHONE_TAKEN');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([{ field: 'phone', messageKey: 'suppliers.errors.phoneTaken' }]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a phone-invalid code onto the phone field', () => {
    const err = new ApiError(400, 'bad', undefined, 'SUPPLIER_PHONE_INVALID');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'phone', messageKey: 'suppliers.errors.phoneInvalid' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a missing-point code onto the point field', () => {
    const err = new ApiError(400, 'bad', undefined, 'COLLECTION_POINT_REQUIRED');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'collection_point_id', messageKey: 'suppliers.errors.pointRequired' },
    ]);
    expect(out.formErrorKey).toBeNull();
  });

  it('degrades a missing-point code to a banner when the point field is absent (operator form)', () => {
    const err = new ApiError(400, 'bad', undefined, 'COLLECTION_POINT_REQUIRED');
    const out = apiErrorToFields(err, ['first_name', 'last_name', 'phone']);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('suppliers.errors.saveFailed');
  });

  it('maps a class-validator name detail onto its field', () => {
    const err = new ApiError(400, 'bad', [
      'last_name must be longer than or equal to 1 characters',
    ]);
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'last_name', messageKey: 'suppliers.errors.nameRequired' },
    ]);
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network'), FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('suppliers.errors.saveFailed');
  });

  it('SUPPLIER_NAME_EMPTY lands on the first-name field', () => {
    const err = new ApiError(400, 'x', undefined, 'SUPPLIER_NAME_EMPTY');
    expect(apiErrorToFields(err, FIELDS).fieldErrors).toEqual([
      { field: 'first_name', messageKey: 'suppliers.errors.nameRequired' },
    ]);
  });

  it('a made-up FOO_PHONE_TAKEN no longer matches', () => {
    const err = new ApiError(409, 'x', undefined, 'FOO_PHONE_TAKEN');
    expect(apiErrorToFields(err, FIELDS).formErrorKey).toBe('suppliers.errors.saveFailed');
  });

  it('a network failure and a 500 get the status sentence, not saveFailed', () => {
    expect(apiErrorToFields(new ApiError(0, 'x'), FIELDS).formErrorKey).toBe('errors.network');
    expect(apiErrorToFields(new ApiError(500, 'x'), FIELDS).formErrorKey).toBe('errors.server');
  });
});
