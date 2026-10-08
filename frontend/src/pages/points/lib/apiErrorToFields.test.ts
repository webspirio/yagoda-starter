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

  it.each([
    ['POINT_NAME_EMPTY', 'name', 'points.errors.nameEmpty'],
    ['POINT_NAME_TAKEN', 'name', 'points.errors.nameTaken'],
    ['POINT_CODE_TAKEN', 'code', 'points.errors.codeTaken'],
  ])('%s lands on the %s field', (code, field, messageKey) => {
    const err = new ApiError(400, 'x', undefined, code);
    expect(apiErrorToFields(err, [...FIELDS, 'code'])).toEqual({
      fieldErrors: [{ field, messageKey }],
      formErrorKey: null,
    });
  });

  it('a made-up FOO_NAME_TAKEN no longer matches', () => {
    const err = new ApiError(409, 'x', undefined, 'FOO_NAME_TAKEN');
    expect(apiErrorToFields(err, FIELDS).formErrorKey).toBe('points.errors.saveFailed');
  });

  it('a network failure and a 500 get the status sentence, not saveFailed', () => {
    expect(apiErrorToFields(new ApiError(0, 'x'), FIELDS).formErrorKey).toBe('errors.network');
    expect(apiErrorToFields(new ApiError(500, 'x'), FIELDS).formErrorKey).toBe('errors.server');
  });
});

it('lands POINT_CODE_TAKEN on the code field', () => {
  const error = new ApiError(409, 'That code is taken', undefined, 'POINT_CODE_TAKEN');
  expect(apiErrorToFields(error, ['name', 'code'])).toEqual({
    fieldErrors: [{ field: 'code', messageKey: 'points.errors.codeTaken' }],
    formErrorKey: null,
  });
});
