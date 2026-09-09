import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = ['name', 'kind', 'target_cash', 'target_crates', 'is_active'];

describe('apiErrorToFields', () => {
  it('maps a name-clash code onto the name field', () => {
    const err = new ApiError(409, 'taken', undefined, 'POINT_NAME_TAKEN');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([{ field: 'name', messageKey: 'points.errors.nameTaken' }]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a deactivation conflict to a form-level banner, not a field', () => {
    const err = new ApiError(409, 'has users', undefined, 'POINT_HAS_ACTIVE_USERS');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('points.errors.hasActiveUsers');
  });

  it('maps a class-validator detail onto its field', () => {
    const err = new ApiError(400, 'bad', ['target_cash must be a decimal string']);
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'target_cash', messageKey: 'points.errors.cashFormat' },
    ]);
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network'), FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('points.errors.saveFailed');
  });
});

it('lands POINT_CODE_TAKEN on the code field', () => {
  const error = new ApiError(409, 'That code is taken', undefined, 'POINT_CODE_TAKEN');
  expect(apiErrorToFields(error, ['name', 'code'])).toEqual({
    fieldErrors: [{ field: 'code', messageKey: 'points.errors.codeTaken' }],
    formErrorKey: null,
  });
});
