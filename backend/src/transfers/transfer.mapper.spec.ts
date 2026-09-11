import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { toTransferResponse } from './transfer.mapper';

/**
 * THE ONLY MONEY ARITHMETIC IN THIS SLICE, and therefore the only place a sign
 * can be flipped. Everything else — the cash formula, the shortfall — is
 * computed by Postgres, where the `.db-spec` covers it; `cash_discrepancy` is
 * computed in JavaScript through `common/money.ts`, and the mapper's own
 * header says the sign «must not be flipped». Nothing enforced that until
 * these tests, so «positive is a shortage» was a comment, not a fact.
 *
 * Spec §11: «mapper: `cash_discrepancy` sign both directions, `null` when not
 * disputed».
 */
const base = (over: Partial<Transfer> = {}): Transfer =>
  ({
    id: 't-1',
    collection_point_id: 'point-a',
    cash: '150000.00',
    crates: 200,
    carrier: 'Іван, Ducato',
    sent_by_user_id: 'u-owner',
    sent_at: new Date('2026-09-04T18:00:00Z'),
    status: TransferStatus.Disputed,
    accepted_by_user_id: 'u-op-a',
    accepted_date: '2026-09-05',
    accepted_at: new Date('2026-09-05T06:00:00Z'),
    reported_cash: '140000.00',
    reported_crates: 195,
    dispute_note: 'мішок легший',
    resolved_cash: null,
    resolved_crates: null,
    resolved_by_user_id: null,
    resolved_at: null,
    correction_of_transfer_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-04T18:00:00Z'),
    updated_at: new Date('2026-09-04T18:00:00Z'),
    ...over,
  }) as Transfer;

describe('toTransferResponse', () => {
  it('a SHORTAGE is POSITIVE — 150 000 declared, 140 000 arrived', () => {
    // The sign convention in one assertion. The opposite reading is equally
    // defensible, which is exactly why it is pinned here: `declared − received`.
    const r = toTransferResponse(base());
    expect(r.cash_discrepancy).toBe('10000.00');
    expect(r.crates_discrepancy).toBe(5);
  });

  it('a SURPLUS is NEGATIVE — nothing clamps this (ticket #20)', () => {
    // §7.7 wants «як недостачу, так і фактично більшу суму», so more money
    // arriving than the base declared is a discrepancy too, not a zero.
    const r = toTransferResponse(
      base({ cash: '140000.00', reported_cash: '150000.00', crates: 195, reported_crates: 200 }),
    );
    expect(r.cash_discrepancy).toBe('-10000.00');
    expect(r.crates_discrepancy).toBe(-5);
  });

  it('resolved_* SUPERSEDES reported_* once the owner has written it', () => {
    // The same precedence the cash formula uses (§6.5's `CASE`): once a
    // dispute is resolved, the owner's figure is the effective one. The
    // discrepancy stays visible forever (§7.7) — it is recomputed, not cleared.
    const r = toTransferResponse(
      base({ resolved_cash: '149000.00', resolved_crates: 199, resolved_at: new Date() }),
    );
    expect(r.cash_discrepancy).toBe('1000.00');
    expect(r.crates_discrepancy).toBe(1);
  });

  it('is NULL on a transfer that is not disputed, in either state', () => {
    // Not `0.00`. A transfer nobody disputed has no discrepancy to report, and
    // a zero would assert that someone counted and found a match.
    const accepted = toTransferResponse(
      base({
        status: TransferStatus.Accepted,
        reported_cash: null,
        reported_crates: null,
        dispute_note: null,
      }),
    );
    expect(accepted.cash_discrepancy).toBeNull();
    expect(accepted.crates_discrepancy).toBeNull();

    const sent = toTransferResponse(
      base({
        status: TransferStatus.Sent,
        accepted_by_user_id: null,
        accepted_date: null,
        accepted_at: null,
        reported_cash: null,
        reported_crates: null,
        dispute_note: null,
      }),
    );
    expect(sent.cash_discrepancy).toBeNull();
    expect(sent.crates_discrepancy).toBeNull();
  });

  it('a DISPUTED transfer whose reported_cash is somehow null reports null, not NaN', () => {
    // Defence in depth: the DTO makes `reported_cash` mandatory on dispute, so
    // this row should not exist — but `money.sub` on `null` would not fail
    // loudly, it would produce a garbage string on a money field.
    const r = toTransferResponse(base({ reported_cash: null, reported_crates: null }));
    expect(r.cash_discrepancy).toBeNull();
    expect(r.crates_discrepancy).toBeNull();
  });

  it('keeps every money field a STRING, exact to the kopiyka', () => {
    const r = toTransferResponse(base({ cash: '0.03', reported_cash: '0.01' }));
    expect(typeof r.cash).toBe('string');
    expect(r.cash_discrepancy).toBe('0.02');
  });
});
