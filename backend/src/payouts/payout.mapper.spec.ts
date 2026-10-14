import { toPayoutDetailResponse, toPayoutResponse } from './payout.mapper';
import { payout, shift } from '../testing/unit/payouts.mocks';

describe('toPayoutResponse', () => {
  it('says whether the shift is closed', () => {
    expect(toPayoutResponse(payout() as never, shift() as never).shift_closed).toBe(false);
    expect(
      toPayoutResponse(payout() as never, shift({ closed_at: new Date() }) as never).shift_closed,
    ).toBe(true);
  });
});

describe('toPayoutResponse — returned_on_void', () => {
  // «Каса за день» mirrors `movementsSql`, which credits a void-time return to
  // the payout's own shift. Without this flag on the wire the client cannot
  // tell that return from one the owner confirmed later, on another day.
  it('carries whether the cash came back at void time', () => {
    expect(toPayoutResponse(payout() as never, shift() as never).returned_on_void).toBe(false);
    expect(
      toPayoutResponse(payout({ returned_on_void: true }) as never, shift() as never)
        .returned_on_void,
    ).toBe(true);
  });
});

describe('toPayoutResponse — balance_after', () => {
  it('carries the frozen balance the receipt prints (#145)', () => {
    expect(
      toPayoutResponse(payout({ balance_after: '5266.00' }) as never, shift() as never)
        .balance_after,
    ).toBe('5266.00');
  });
});

describe('toPayoutDetailResponse', () => {
  it('adds the payer number and the point number to the row (#145)', () => {
    const res = toPayoutDetailResponse(payout() as never, shift() as never, 5, 3);
    expect(res.paid_by_number).toBe(5);
    expect(res.point_number).toBe(3);
    expect(res.code).toBe(payout().code);
  });

  it('answers a null payer number when the user row is gone', () => {
    expect(toPayoutDetailResponse(payout() as never, shift() as never, null, 3).paid_by_number).toBeNull();
  });
});

describe('toPayoutResponse — a list row', () => {
  it('carries neither number — only GET /payouts/:id loads them', () => {
    const res = toPayoutResponse(payout() as never, shift() as never);
    expect(res).not.toHaveProperty('paid_by_number');
    expect(res).not.toHaveProperty('point_number');
  });
});
