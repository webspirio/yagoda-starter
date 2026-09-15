import { toCashCountRowResponse, type CashCountRow } from './cash-count.mapper';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

const row = (over: Partial<CashCountRow> = {}): CashCountRow => ({
  id: 'cc-1',
  shift_id: 'sh-1',
  collection_point_id: 'p1',
  business_date: '2026-09-09',
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '15066.10',
  expected_amount: '15416.10',
  counted_by_user_id: 'u-op',
  counted_at: new Date('2026-09-09T17:55:00Z'),
  explanation: null,
  ...over,
});

describe('toCashCountRowResponse', () => {
  it('a shortage is NEGATIVE — the opposite of a transfer discrepancy, deliberately', () => {
    expect(toCashCountRowResponse(row()).discrepancy).toBe('-350.00');
  });

  it('a surplus is positive', () => {
    expect(
      toCashCountRowResponse(row({ counted_amount: '15766.10' })).discrepancy,
    ).toBe('350.00');
  });

  it('a matching count reads 0.00 and is not open', () => {
    const r = toCashCountRowResponse(row({ counted_amount: '15416.10' }));
    expect(r.discrepancy).toBe('0.00');
    expect(r.is_open).toBe(false);
  });

  it('a discrepancy with no explanation is OPEN', () => {
    expect(toCashCountRowResponse(row()).is_open).toBe(true);
  });

  it('an explained discrepancy is closed, and its numbers do not move', () => {
    const r = toCashCountRowResponse(row({ explanation: 'касир помилився решткою' }));
    expect(r.is_open).toBe(false);
    // §7.7 — «розбіжність у документі лишається, її не підганяють».
    expect(r.discrepancy).toBe('-350.00');
    expect(r.counted_amount).toBe('15066.10');
  });
});
