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

  it('tells the day apart from the open shift — one point, one shift per date', () => {
    // ShiftsService.open, UQ_shifts_point_business_date: the remedy is a reopen,
    // not a close, which is why it cannot share alreadyOpen's line.
    expect(apiErrorToBanner(apiError(409, 'SHIFT_DAY_ALREADY_USED'))).toBe(
      'day.errors.dayAlreadyUsed',
    );
  });

  it('says only the point’s most recent shift can be reopened', () => {
    expect(apiErrorToBanner(apiError(409, 'SHIFT_NOT_NEWEST'))).toBe('day.errors.notNewest');
  });

  it('names the owner as the only actor for an owner-only verb', () => {
    expect(apiErrorToBanner(apiError(403, 'OWNER_ONLY'))).toBe('day.errors.ownerOnly');
  });

  it('sends an operator with no point to the owner', () => {
    expect(apiErrorToBanner(apiError(403, 'NO_COLLECTION_POINT'))).toBe('day.errors.noPoint');
  });

  it('falls back for an operator acting on another point — that 404 carries no code', () => {
    expect(apiErrorToBanner(apiError(404))).toBe('day.errors.failed');
  });

  it('falls back for a code this screen has never seen', () => {
    expect(apiErrorToBanner(apiError(409, 'SOME_FUTURE_CODE'))).toBe('day.errors.failed');
  });

  it('falls back for a non-ApiError (network down, aborted request)', () => {
    expect(apiErrorToBanner(new Error('network down'))).toBe('day.errors.failed');
  });
});
