import { isTruncated } from '@/shared/api';
import { useIntakesQuery, type Intake } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { buildDaySummary, type DaySummary } from '../lib/daySummary';

/** One line of «Документи дня»: a receipt or a payout, newest first. */
export interface DayFeedRow {
  kind: 'intake' | 'payout';
  /** The receipt itself on an intake row — what `canVoidIntake` reads. */
  intake: Intake | null;
  /** True on a payout row with no receipt behind it — the only one with a
   *  document of its own to open. */
  standalonePayout: boolean;
  id: string;
  code: string;
  amount: string;
  at: string;
  supplierId: string;
  voided: boolean;
  reason: string | null;
}

export interface DayDocuments {
  summary: DaySummary;
  feed: DayFeedRow[];
  /** Either journal came back capped at its `limit` — the tiles would
   *  under-report, so the page says so rather than raising the limit. */
  truncated: boolean;
  /** Both journals are in. Gated on the shift's id, so there is always a
   *  round trip where the shift is known and they are not — totals over that
   *  gap would be zeros, which on a cash screen read as «nothing happened». */
  ready: boolean;
  isError: boolean;
}

/**
 * The shift's own documents, read BY SHIFT — what «Каса за день» showed and
 * #221 folded into «Каса точки». Deliberately NOT the reads `CashLedger`
 * makes on the same page (`pointId` + a date range, for its informational
 * rows): those answer «what was accrued around this date», this answers
 * «what was written in this shift», and they are capped separately.
 *
 * Totals are DISPLAY sums over document headers (`buildDaySummary`, added in
 * kopiykas by `shared/lib/money`); nothing here is money the server has not
 * already computed and frozen onto a document.
 */
export function useDayDocuments(date: string, shiftId: string | undefined): DayDocuments {
  const intakes = useIntakesQuery({ shiftId });
  const payouts = usePayoutsQuery({ shiftId });

  const intakeRows = intakes.data?.data ?? [];
  const payoutRows = payouts.data?.data ?? [];

  const feed: DayFeedRow[] = [
    ...intakeRows.map(
      (i: Intake): DayFeedRow => ({
        kind: 'intake',
        intake: i,
        standalonePayout: false,
        id: i.id,
        code: i.code,
        amount: i.amount,
        at: i.created_at,
        supplierId: i.supplier_id,
        voided: i.voided_at !== null,
        reason: i.void_reason,
      }),
    ),
    ...payoutRows.map(
      (p: Payout): DayFeedRow => ({
        kind: 'payout',
        intake: null,
        standalonePayout: p.intake_id === null,
        id: p.id,
        code: p.code,
        amount: p.amount,
        at: p.created_at,
        supplierId: p.supplier_id,
        voided: p.voided_at !== null,
        reason: p.void_reason,
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    summary: buildDaySummary(intakeRows, payoutRows, date),
    feed,
    truncated: isTruncated(intakes.data) || isTruncated(payouts.data),
    ready: !intakes.isPending && !payouts.isPending,
    isError: intakes.isError || payouts.isError,
  };
}
