import { toIntakeResponse, toIntakeDetailResponse } from './intake.mapper';
import { intake, shift } from '../testing/unit/intakes.mocks';

const extras = {
  net_kg: '0.000',
  lines_count: 0,
  supplier_name: 'x',
  paid_amount: '0.00',
  open_amount: '0.00',
};

describe('intake mapper', () => {
  it('says whether the shift is closed', () => {
    expect(toIntakeResponse(intake() as never, shift() as never, extras).shift_closed).toBe(false);
    expect(
      toIntakeResponse(intake() as never, shift({ closed_at: new Date() }) as never, extras)
        .shift_closed,
    ).toBe(true);
  });

  it('gives each bound payout its created_at', () => {
    const at = new Date('2026-09-08T11:32:00.000Z');
    const res = toIntakeDetailResponse(
      intake() as never,
      shift() as never,
      [],
      extras,
      [{ id: 'p', code: 'PO', amount: '1.00', voided_at: null, created_at: at }] as never,
      null,
      null,
    );
    expect(res.payouts[0].created_at).toBe('2026-09-08T11:32:00.000Z');
  });
});
