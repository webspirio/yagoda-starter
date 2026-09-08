import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToBanner } from './apiErrorToBanner';

/** ApiError(status, message, details?, code?) — built from the parts each case
 *  cares about, so a test reads as the server response it stands for. */
const apiError = (status: number, code?: string) =>
  new ApiError(status, 'Request failed', undefined, code);

describe('apiErrorToBanner', () => {
  it('names the open shift that blocks opening another one', () => {
    // ShiftsService.open (UQ_shifts_open_per_point) and reopen both throw this.
    expect(apiErrorToBanner(apiError(409, 'SHIFT_ALREADY_OPEN'))).toBe('day.errors.alreadyOpen');
  });

  it('says the shift is not open when a close arrives on a closed one', () => {
    expect(apiErrorToBanner(apiError(409, 'SHIFT_ALREADY_CLOSED'))).toBe('day.errors.notOpen');
  });

  it('says only a closed shift can be reopened', () => {
    expect(apiErrorToBanner(apiError(409, 'SHIFT_NOT_CLOSED'))).toBe('day.errors.notClosed');
  });

  it('falls back for an operator acting on another point — that 404 carries no code', () => {
    expect(apiErrorToBanner(apiError(404))).toBe('day.errors.failed');
  });

  it('falls back for a shift code with no copy of its own', () => {
    // SHIFT_NOT_NEWEST, SHIFT_DAY_ALREADY_USED, OWNER_ONLY and
    // NO_COLLECTION_POINT are all reachable but have no dedicated line yet.
    expect(apiErrorToBanner(apiError(409, 'SHIFT_NOT_NEWEST'))).toBe('day.errors.failed');
    expect(apiErrorToBanner(apiError(403, 'OWNER_ONLY'))).toBe('day.errors.failed');
  });

  it('falls back for a non-ApiError (network down, aborted request)', () => {
    expect(apiErrorToBanner(new Error('network down'))).toBe('day.errors.failed');
  });
});
