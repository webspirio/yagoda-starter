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
    const err = new ApiError(409, 'taken', undefined, 'LOGIN_TAKEN');
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

  it.each([
    ['LAST_OWNER', 409, 'users.errors.lastOwner'],
    ['SELF_LOCKOUT', 403, 'users.errors.selfLockout'],
    ['OWNER_HAS_NO_POINT', 400, 'users.errors.ownerHasNoPoint'],
    ['POINT_UNUSABLE', 400, 'users.errors.pointUnusable'],
    ['USER_NAME_EMPTY', 400, 'users.errors.nameRequired'],
  ])('%s banners its own sentence, even on a 403', (code, status, key) => {
    expect(apiErrorToFields(new ApiError(status, 'x', undefined, code), FIELDS)).toEqual({
      fieldErrors: [],
      formErrorKey: key,
    });
  });

  it('OPERATOR_NEEDS_POINT lands on the point field', () => {
    expect(
      apiErrorToFields(new ApiError(400, 'x', undefined, 'OPERATOR_NEEDS_POINT'), FIELDS).fieldErrors,
    ).toEqual([{ field: 'collection_point_id', messageKey: 'users.errors.pointRequired' }]);
  });

  it('a made-up *_LOGIN_TAKEN no longer matches', () => {
    const err = new ApiError(409, 'x', undefined, 'USER_LOGIN_TAKEN');
    expect(apiErrorToFields(err, FIELDS).formErrorKey).toBe('users.errors.saveFailed');
  });

  it('a network failure and a 500 get the status sentence, not saveFailed', () => {
    expect(apiErrorToFields(new ApiError(0, 'x'), FIELDS).formErrorKey).toBe('errors.network');
    expect(apiErrorToFields(new ApiError(500, 'x'), FIELDS).formErrorKey).toBe('errors.server');
  });
});
