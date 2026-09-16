import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToBanner } from './apiErrorToBanner';

/** ApiError(status, message, details?, code?) — built from the parts each case
 *  cares about, so a test reads as the server response it stands for. */
const apiError = (status: number, code?: string) =>
  new ApiError(status, 'Request failed', undefined, code);

describe('apiErrorToBanner', () => {
  describe('inherited from void-document (void.errors.*)', () => {
    const FALLBACK = 'void.errors.failed';

    it.each([
      ['NOT_YOUR_DOCUMENT', 'void.errors.notYourDocument'],
      ['SHIFT_CLOSED', 'void.errors.shiftClosed'],
      ['ALREADY_VOIDED', 'void.errors.alreadyVoided'],
    ])('maps %s to %s', (code, key) => {
      expect(apiErrorToBanner(apiError(403, code), FALLBACK)).toBe(key);
    });

    it('falls back to the caller-supplied key for an unrecognised code', () => {
      expect(apiErrorToBanner(apiError(400, 'SOMETHING_ELSE'), FALLBACK)).toBe(FALLBACK);
    });

    it('falls back to the caller-supplied key for a non-ApiError', () => {
      expect(apiErrorToBanner(new Error('network down'), FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('inherited from count-shift (day.errors.*)', () => {
    const FALLBACK = 'day.errors.failed';

    it('names the open shift that blocks opening another one', () => {
      // ShiftsService.open (UQ_shifts_open_per_point) and reopen both throw this.
      expect(apiErrorToBanner(apiError(409, 'SHIFT_ALREADY_OPEN'), FALLBACK)).toBe(
        'day.errors.alreadyOpen',
      );
    });

    it('says the shift is not open when a close arrives on a closed one', () => {
      expect(apiErrorToBanner(apiError(409, 'SHIFT_ALREADY_CLOSED'), FALLBACK)).toBe(
        'day.errors.notOpen',
      );
    });

    it('says only a closed shift can be reopened', () => {
      expect(apiErrorToBanner(apiError(409, 'SHIFT_NOT_CLOSED'), FALLBACK)).toBe(
        'day.errors.notClosed',
      );
    });

    it('tells the day apart from the open shift — one point, one shift per date', () => {
      // ShiftsService.open, UQ_shifts_point_business_date: the remedy is a reopen,
      // not a close, which is why it cannot share alreadyOpen's line.
      expect(apiErrorToBanner(apiError(409, 'SHIFT_DAY_ALREADY_USED'), FALLBACK)).toBe(
        'day.errors.dayAlreadyUsed',
      );
    });

    it('says only the point’s most recent shift can be reopened', () => {
      expect(apiErrorToBanner(apiError(409, 'SHIFT_NOT_NEWEST'), FALLBACK)).toBe(
        'day.errors.notNewest',
      );
    });

    it('names the owner as the only actor for an owner-only verb', () => {
      expect(apiErrorToBanner(apiError(403, 'OWNER_ONLY'), FALLBACK)).toBe('day.errors.ownerOnly');
    });

    it('sends an operator with no point to the owner', () => {
      expect(apiErrorToBanner(apiError(403, 'NO_COLLECTION_POINT'), FALLBACK)).toBe(
        'day.errors.noPoint',
      );
    });

    it('falls back for an operator acting on another point — that 404 carries no code', () => {
      expect(apiErrorToBanner(apiError(404), FALLBACK)).toBe(FALLBACK);
    });

    it('falls back for a code this screen has never seen', () => {
      expect(apiErrorToBanner(apiError(409, 'SOME_FUTURE_CODE'), FALLBACK)).toBe(FALLBACK);
    });

    it('falls back for a non-ApiError (network down, aborted request)', () => {
      expect(apiErrorToBanner(new Error('network down'), FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('cash & transfers slice (#62)', () => {
    const FALLBACK = 'transfer.errors.failed';

    it('names the missing shift when accepting/disputing a delivery outside one', () => {
      // TransfersService.transition: accepted_date comes from the open shift
      // (§4.2), so an accept/dispute outside one belongs to no shift's
      // arithmetic — it must say so, not "something went wrong".
      expect(apiErrorToBanner(apiError(409, 'NO_OPEN_SHIFT'), FALLBACK)).toBe(
        'transfer.errors.noOpenShift',
      );
    });

    it('says only the point may sign for a delivery, never the owner', () => {
      // TransfersService.transition — §10.3 inverts the usual shape: the
      // owner may NOT accept or dispute.
      expect(apiErrorToBanner(apiError(403, 'POINT_OPERATOR_ONLY'), FALLBACK)).toBe(
        'transfer.errors.pointOperatorOnly',
      );
    });

    it('says a voided transfer has nothing left to sign for', () => {
      expect(apiErrorToBanner(apiError(409, 'TRANSFER_VOIDED'), FALLBACK)).toBe(
        'transfer.errors.voided',
      );
    });

    it('says the transfer already has an answer', () => {
      expect(apiErrorToBanner(apiError(409, 'TRANSFER_ALREADY_ANSWERED'), FALLBACK)).toBe(
        'transfer.errors.alreadyAnswered',
      );
    });

    it('says only a disputed transfer can be resolved', () => {
      expect(apiErrorToBanner(apiError(409, 'TRANSFER_NOT_DISPUTED'), FALLBACK)).toBe(
        'transfer.errors.notDisputed',
      );
    });

    it('says the dispute is already resolved', () => {
      expect(apiErrorToBanner(apiError(409, 'TRANSFER_ALREADY_RESOLVED'), FALLBACK)).toBe(
        'transfer.errors.alreadyResolved',
      );
    });

    it('names the deactivated point that refuses a new transfer', () => {
      expect(apiErrorToBanner(apiError(400, 'POINT_INACTIVE'), FALLBACK)).toBe(
        'transfer.errors.pointInactive',
      );
    });

    it('says a correction must name a transfer at the same point', () => {
      expect(apiErrorToBanner(apiError(400, 'CORRECTION_POINT_MISMATCH'), FALLBACK)).toBe(
        'transfer.errors.correctionPointMismatch',
      );
    });
  });

  it('one code maps to one banner regardless of which screen is asking', () => {
    // OWNER_ONLY is thrown by ShiftsService, PayoutsService and
    // TransfersService.resolve alike — the map does not care which screen
    // calls it, only the caller-supplied fallback differs per screen.
    expect(apiErrorToBanner(apiError(403, 'OWNER_ONLY'), 'void.errors.failed')).toBe(
      'day.errors.ownerOnly',
    );
  });

  it('the fallback is whatever the caller passes — there is no shared default', () => {
    expect(apiErrorToBanner(new Error('network down'), 'transfer.errors.failed')).toBe(
      'transfer.errors.failed',
    );
  });

  describe('overrides — one code whose sentence depends on the endpoint', () => {
    // SUPPLIER_INACTIVE is refused by `POST /intake-top-ups` and
    // `POST /crate-issuances` alike, but «a debt nobody could pay out» and
    // «crates cannot be issued to them» are different consequences, so the
    // shared map holds neither and each screen passes its own.
    const TOP_UP = { SUPPLIER_INACTIVE: 'topUp.errors.supplierInactive' };
    const CRATES = { SUPPLIER_INACTIVE: 'crates.errors.supplierInactive' };

    it('gives each screen its own sentence for the same code', () => {
      const error = apiError(400, 'SUPPLIER_INACTIVE');
      expect(apiErrorToBanner(error, 'topUp.errors.failed', TOP_UP)).toBe(
        'topUp.errors.supplierInactive',
      );
      expect(apiErrorToBanner(error, 'crates.errors.issueFailed', CRATES)).toBe(
        'crates.errors.supplierInactive',
      );
    });

    it('falls back rather than borrowing the other screen’s sentence', () => {
      // A screen that passes no override must not inherit one — the whole
      // reason this code is absent from the shared map.
      expect(apiErrorToBanner(apiError(400, 'SUPPLIER_INACTIVE'), 'void.errors.failed')).toBe(
        'void.errors.failed',
      );
    });

    it('leaves every other code to the shared map', () => {
      expect(apiErrorToBanner(apiError(403, 'OWNER_ONLY'), 'topUp.errors.failed', TOP_UP)).toBe(
        'day.errors.ownerOnly',
      );
    });
  });

  it('falls back for an empty-string code rather than returning the empty string itself', () => {
    // `(code && CODE[code]) ?? fallback` short-circuits on `code: ''` to `''`
    // itself — `??` only falls back on null/undefined, not on falsy-but-not-
    // nullish values — so an empty-string code used to render a blank banner
    // instead of the caller's fallback.
    expect(apiErrorToBanner(apiError(400, ''), 'transfer.errors.failed')).toBe(
      'transfer.errors.failed',
    );
  });
});
