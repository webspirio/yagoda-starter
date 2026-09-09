import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToBanner } from './apiErrorToBanner';

describe('apiErrorToBanner', () => {
  it.each([
    ['NOT_YOUR_DOCUMENT', 'void.errors.notYourDocument'],
    ['SHIFT_CLOSED', 'void.errors.shiftClosed'],
    ['ALREADY_VOIDED', 'void.errors.alreadyVoided'],
  ])('maps %s to %s', (code, key) => {
    const error = new ApiError(403, 'nope', undefined, code);
    expect(apiErrorToBanner(error)).toBe(key);
  });

  it('falls back to void.errors.failed for an unrecognised code', () => {
    const error = new ApiError(400, 'nope', undefined, 'SOMETHING_ELSE');
    expect(apiErrorToBanner(error)).toBe('void.errors.failed');
  });

  it('falls back to void.errors.failed for a non-ApiError', () => {
    expect(apiErrorToBanner(new Error('network down'))).toBe('void.errors.failed');
  });
});
