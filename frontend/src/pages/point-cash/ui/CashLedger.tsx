import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { sub, isNegative, formatUah } from '@/shared/lib/money';
import {
  buildLedger,
  type LedgerIntake,
  type LedgerPayout,
  type LedgerRow,
  type LedgerRowKey,
  type LedgerTransfer,
} from '../lib/buildLedger';

/** Rows that read as money OUT get their sign flipped for display —
 *  `buildLedger` itself only ever returns non-negative magnitudes. */
const OUTFLOW = new Set<LedgerRowKey>(['paidToday', 'paidPast']);

/**
 * Rows that do NOT explain today's cash figure, rendered apart from the
 * ones that do (review round 1 finding 3, extended in review round 2
 * finding 2, and again for R6). `accruedToday` never explained it — berries
 * received move no cash. `paidPast` maps onto no term of `movementsSql` — a
 * payout from an earlier day is already folded into an earlier drawer
 * count, not into today's math. `opening` is the count today's movements
 * are measured FROM, not one of those movements itself. See `buildLedger`'s
 * own comment for the full reasoning.
 */
const INFORMATIONAL = new Set<LedgerRowKey>(['opening', 'accruedToday', 'paidPast']);

/**
 * `LedgerRowKey`s that can actually arrive with `truncated: true`. `opening`
 * is excluded on purpose — `buildLedger` always hands its row
 * `truncated: false` (a single date+kind+book read, never a capped page),
 * so there is no caveat for it to show and no translation key to invent for
 * one that can never render.
 */
type TruncatableRowKey = Exclude<LedgerRowKey, 'opening'>;

/**
 * The caveat a truncated row shows, named for WHAT IS ACTUALLY MISSING from
 * it. `buildLedger` decides WHETHER a row is truncated (it owns the mapping
 * from row to source page); this only decides how to say so, and a row fed
 * by the transfers page must not tell the reader that older payouts may be
 * missing from it.
 *
 * AN EXHAUSTIVE `Record`, NOT AN IF-CHAIN WITH A FALLTHROUGH `return`: the
 * old shape's final `return 'pointCash.ledger.paidPastTruncated'` answered
 * for any key that was neither `accruedToday` nor `cashIn` — right for the
 * three payouts-fed rows it was written for (`paidToday`, `paidPast`,
 * `returnedToday`), but silently right (or silently wrong) for a row nobody
 * had added yet too. A new TRUNCATABLE `LedgerRowKey` now fails to compile
 * here instead.
 */
const TRUNCATION_KEY: Record<TruncatableRowKey, string> = {
  accruedToday: 'pointCash.ledger.accruedTodayTruncated',
  cashIn: 'pointCash.ledger.cashInTruncated',
  // paidToday's own row is never actually truncated (`buildLedger` always
  // hands it `truncated: false`), but it shares payouts' array with
  // paidPast/returnedToday, so it shares their wording too, matching the
  // old fallthrough exactly, should that ever change.
  paidToday: 'pointCash.ledger.paidPastTruncated',
  paidPast: 'pointCash.ledger.paidPastTruncated',
  returnedToday: 'pointCash.ledger.paidPastTruncated',
};

/**
 * «Звідки взялося це число» — the schedule behind the point's cash figure.
 *
 * THE TOTAL AT THE BOTTOM IS `cash`, THE PROP — NEVER A SUM OF THE ROWS
 * ABOVE IT. `GET /point-cash/:pointId` is one SQL formula on the backend;
 * this component's own rows are a client-side DISPLAY reconstruction from
 * `intakes`/`payouts`/`transfers` that may be built from an incomplete page
 * of documents (§ Task 19 rule 1). If the two disagree, printing the sum of
 * the rows instead of `cash` would hide that gap — a quiet discrepancy is
 * worse than a visible one, so this component never computes its own total.
 *
 * `opening`/`accruedToday`/`paidPast` ARE RENDERED SEPARATELY FROM THE THREE
 * ROWS THAT ACTUALLY MOVE CASH (`paidToday`/`returnedToday`/`cashIn`), behind
 * a shared divider, a muted tone and their own hint text: under a heading
 * that promises to explain the cash figure, a row that does not belong to
 * that explanation must not look like the ones that do — a reader
 * sanity-checking by addition would otherwise fold it in and get the wrong
 * number.
 *
 * R6 also adds a negative-cash notice under the total (`ledger.negative`)
 * and a footnote explaining why payouts read as two rows
 * (`ledger.twoRowsNote`) — neither changes what the total prints, only what
 * is said about it.
 */
export function CashLedger({
  date,
  cash,
  intakes,
  payouts,
  transfers,
  intakesTruncated = false,
  payoutsTruncated = false,
  transfersTruncated = false,
  openingCount = null,
  target = null,
}: {
  date: string;
  cash: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  transfers: LedgerTransfer[];
  /**
   * True when the array beside it is only the most recent page (`total`
   * exceeds what was actually fetched). EVERY ONE OF THE THREE READS IS
   * CAPPED AT 100, so every one of them can feed a row that covers recent
   * history only — the caveat is not a payouts speciality (review round 1,
   * finding 4 started with `paidPast`; `returnedToday` joined it in fix
   * round 1, and transfers and intakes here). `buildLedger` maps each flag
   * onto the rows it actually affects.
   */
  intakesTruncated?: boolean;
  payoutsTruncated?: boolean;
  transfersTruncated?: boolean;
  /** R6 — the day's opening berry count, or `null` when none was taken yet. See `buildLedger`'s own doc comment. */
  openingCount?: string | null;
  /** R6 — the point's assigned cash target, captions the opening row only. See `buildLedger`'s own doc comment. */
  target?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const rows = buildLedger({
    date,
    intakes,
    payouts,
    transfers,
    intakesTruncated,
    payoutsTruncated,
    transfersTruncated,
    openingCount,
    target,
  });
  const locale = i18n.resolvedLanguage;

  const informational = rows.filter((r) => INFORMATIONAL.has(r.key));
  const movements = rows.filter((r) => !INFORMATIONAL.has(r.key));

  // `opening`'s hint is dynamic (the target figure, interpolated), never a
  // fixed translation key — every other informational row still gets its
  // hint from `${key}Hint`, unconditionally, exactly as before R6.
  const hintFor = (row: LedgerRow): string | undefined =>
    row.key === 'opening'
      ? row.hint !== undefined
        ? t('pointCash.ledger.openingHint', { target: formatUah(row.hint, locale) })
        : undefined
      : t(`pointCash.ledger.${row.key}Hint`);

  const truncationCaveat = (row: LedgerRow) =>
    row.truncated && row.key !== 'opening' ? (
      <p className="pb-1 text-xs text-muted-foreground">{t(TRUNCATION_KEY[row.key])}</p>
    ) : null;

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {informational.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              hint={hintFor(row)}
              value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
              className="opacity-70"
            />
            {truncationCaveat(row)}
          </Fragment>
        ))}
        <div className="my-2 border-b border-dashed border-border" />

        {movements.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
              tone={row.key === 'cashIn' || row.key === 'returnedToday' ? 'leaf' : 'default'}
            />
            {truncationCaveat(row)}
          </Fragment>
        ))}

        <div className="my-2 border-t border-border" />
        <LedgerRowView
          label={t('pointCash.ledger.total')}
          value={formatUah(cash, locale)}
          strong
          tone={isNegative(cash) ? 'bad' : 'default'}
        />
        {/* R6 — negative berry cash is not a data-entry error; it means the
            point paid out more than it ever held for berries. Said in words
            right under the number it explains, not left for the reader to
            infer from a red total alone. */}
        {isNegative(cash) ? (
          <p className="pt-1 text-xs text-destructive">{t('pointCash.ledger.negative')}</p>
        ) : null}
        {/* R6 — why `paidToday` and `paidPast` are two rows instead of one
            «paid out» figure, generically (no demo numbers, unlike the
            mock's own version of this line). Unconditional: the two rows
            are always on screen, so the explanation always applies. */}
        <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
          {t('pointCash.ledger.twoRowsNote')}
        </p>
      </div>
    </SectionCard>
  );
}
