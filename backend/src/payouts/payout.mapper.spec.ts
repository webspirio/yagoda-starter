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
