import { toPayoutResponse } from './payout.mapper';
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
