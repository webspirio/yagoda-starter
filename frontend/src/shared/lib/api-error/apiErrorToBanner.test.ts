import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToBanner, apiErrorParams, statusKey, toBannerError } from './apiErrorToBanner';

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

    it('says the shift is already closed when a close arrives on a closed one', () => {
      // A double tap or a stale tab — there is no shift to open that day.
      expect(apiErrorToBanner(apiError(409, 'SHIFT_ALREADY_CLOSED'), FALLBACK)).toBe(
        'day.errors.alreadyClosed',
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

  describe('reweigh (§8)', () => {
    const FALLBACK = 'reweigh.errors.postFailed';

    it.each([
      ['NOTHING_ACCEPTED', 'reweigh.errors.nothingAccepted'],
      ['GRADE_NOT_ACCEPTED', 'reweigh.errors.gradeNotAccepted'],
      ['NET_NOT_POSITIVE', 'reweigh.errors.netNotPositive'],
      ['TARE_TYPE_DUPLICATED', 'reweigh.errors.tareDuplicated'],
      ['TARE_TYPE_UNKNOWN', 'reweigh.errors.tareUnknown'],
    ])('maps %s to %s', (code, key) => {
      expect(apiErrorToBanner(apiError(400, code), FALLBACK)).toBe(key);
    });

    it('a 500 with no code gets the shared server sentence, a 404 still the post’s own key', () => {
      expect(apiErrorToBanner(apiError(500), FALLBACK)).toBe('errors.server');
      expect(apiErrorToBanner(apiError(404), FALLBACK)).toBe(FALLBACK);
    });

    it('shares ALREADY_VOIDED with every other document — §8.7 is not special', () => {
      expect(apiErrorToBanner(apiError(409, 'ALREADY_VOIDED'), 'reweigh.day.errors.failed')).toBe(
        'void.errors.alreadyVoided',
      );
    });
  });

  describe('crates — a receipt-linked return', () => {
    it('says a return recorded with a receipt has no void of its own', () => {
      // `POST /crate-returns/:id/void` refuses a return `POST /intakes`
      // wrote alongside a receipt (§8.3, `returned_crates`) with this code —
      // reachable from a stale crates list still showing a void button for
      // one. `VoidDocumentDialog` calls this with the generic
      // `void.errors.failed` fallback, and the shared map must still resolve
      // it to the crates-specific sentence rather than the generic one.
      expect(apiErrorToBanner(apiError(409, 'RETURN_BELONGS_TO_INTAKE'), 'void.errors.failed')).toBe(
        'crates.errors.returnBelongsToIntake',
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

const onHand = (inTransit: number) =>
  new ApiError(409, 'Request failed', undefined, 'CRATES_ON_HAND_INSUFFICIENT', {
    code: 'CRATES_ON_HAND_INSUFFICIENT', available: 5, required: 15, in_transit: inTransit, message: 'x',
  });

describe('CRATES_ON_HAND_INSUFFICIENT', () => {
  it('maps to the plain sentence when nothing is in transit', () => {
    expect(apiErrorToBanner(onHand(0), 'crates.errors.issueFailed')).toBe('crates.errors.onHandInsufficient');
  });
  it('points at the transfer in transit when there is one', () => {
    expect(apiErrorToBanner(onHand(20), 'crates.errors.issueFailed')).toBe('crates.errors.onHandInsufficientInTransit');
  });
  it('carries the numbers for interpolation, and only the numbers', () => {
    expect(apiErrorParams(onHand(20))).toMatchObject({ available: 5, required: 15, in_transit: 20 });
    expect(apiErrorParams(onHand(20))).not.toHaveProperty('message');
  });
  it('toBannerError bundles both', () => {
    expect(toBannerError(onHand(0), 'x')).toEqual({
      key: 'crates.errors.onHandInsufficient',
      params: expect.objectContaining({ available: 5, required: 15 }),
    });
  });
  it('has no params for a non-ApiError', () => expect(apiErrorParams(new Error('down'))).toEqual({}));
});

describe('statusKey', () => {
  it.each([
    [0, 'errors.network'],
    [429, 'errors.tooManyRequests'],
    [403, 'errors.accessChanged'],
    [500, 'errors.server'],
    [503, 'errors.server'],
  ])('status %i → %s', (status, key) => {
    expect(statusKey(new ApiError(status, 'raw'))).toBe(key);
  });

  it('has nothing to say about a 404, a 400 or a non-ApiError', () => {
    expect(statusKey(new ApiError(404, 'Supplier not found'))).toBeUndefined();
    expect(statusKey(new ApiError(400, 'x'))).toBeUndefined();
    expect(statusKey(new Error('boom'))).toBeUndefined();
  });
});

describe('apiErrorToBanner precedence', () => {
  it('a known code beats the status: OWNER_ONLY on a 403 keeps its own sentence', () => {
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'OWNER_ONLY'), 'f')).toBe('day.errors.ownerOnly');
  });
  it('an unknown code on a 5xx gets the status sentence, not the fallback', () => {
    expect(apiErrorToBanner(new ApiError(500, 'x', undefined, 'SOMETHING_NEW'), 'f')).toBe('errors.server');
  });
  it('no code: status first, then the fallback', () => {
    expect(apiErrorToBanner(new ApiError(0, 'Request failed with status 0'), 'f')).toBe('errors.network');
    expect(apiErrorToBanner(new ApiError(404, 'Supplier not found'), 'f')).toBe('f');
  });
  it('the two coded 403s map to the access sentence by name', () => {
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'INSUFFICIENT_ROLE'), 'f')).toBe('errors.accessChanged');
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'WRONG_COLLECTION_POINT'), 'f')).toBe('errors.accessChanged');
  });
  // POINT_REQUIRED comes only from GET /crate-standing, whose error no screen
  // maps — so it has no entry, and only COLLECTION_POINT_REQUIRED keeps the sentence.
  it('maps COLLECTION_POINT_REQUIRED, and leaves the unrendered POINT_REQUIRED unmapped', () => {
    expect(apiErrorToBanner(new ApiError(400, 'x', undefined, 'COLLECTION_POINT_REQUIRED'), 'f')).toBe('errors.pointRequired');
    expect(apiErrorToBanner(new ApiError(400, 'x', undefined, 'POINT_REQUIRED'), 'f')).toBe('f');
  });
});
