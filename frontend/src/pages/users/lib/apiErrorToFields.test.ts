import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = [
  'first_name',
  'last_name',
  'login',
  'password',
  'role',
  'collection_point_id',
  'is_active',
];

describe('apiErrorToFields', () => {
  it('maps a login-clash code onto the login field', () => {
    const err = new ApiError(409, 'taken', undefined, 'USER_LOGIN_TAKEN');
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([{ field: 'login', messageKey: 'users.errors.loginTaken' }]);
    expect(out.formErrorKey).toBeNull();
  });

  it('maps a class-validator detail onto its field', () => {
    const err = new ApiError(400, 'bad', ['password must be longer than or equal to 8 characters']);
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'password', messageKey: 'users.errors.passwordShort' },
    ]);
  });

  it('routes a login-whitespace validation message to its own key', () => {
    const err = new ApiError(400, 'bad', ['login must not contain whitespace']);
    const out = apiErrorToFields(err, FIELDS);
    expect(out.fieldErrors).toEqual([
      { field: 'login', messageKey: 'users.errors.loginWhitespace' },
    ]);
  });

  it('falls back to a form-level error for a non-ApiError', () => {
    const out = apiErrorToFields(new Error('network'), FIELDS);
    expect(out.fieldErrors).toEqual([]);
    expect(out.formErrorKey).toBe('users.errors.saveFailed');
  });
});
