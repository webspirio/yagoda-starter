import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { Spinner } from '@/shared/ui/spinner';
import { sub, isNegative, isZero, formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { DiscrepancyText } from '@/entities/cash-count';
import { buildLedger, shiftDateOf, type LedgerIntake } from '../lib/buildLedger';

/**
 * «Звідки взялося це число».
 *
 * EVERY ROW UNDER THE DIVIDER IS THE SERVER'S `breakdown` (#73), read in the
 * same statement as `cash`, so the rows add up by construction: on an open day
 * to `cash` itself, on a closed day to «Мало бути», which the closing count
 * then corrects by the difference. Nothing here re-derives a term of the
 * formula. The one row ABOVE the divider is informational — berries accrued
 * move no cash — and is never summed. (A «paid on earlier days» row used to
 * sit beside it: a season-long running total, gone — audit 2026-10-24, C1.)
 *
 * No row says «сьогодні»: the page reads past dates as readily as today, so
 * the terms say «за день» (C6).
 */
export function CashLedger({
  date,
  cash,
  breakdown,
  failed = false,
  intakes,
  intakesTruncated = false,
}: {
  date: string;
  cash: string | undefined;
  breakdown: PointCashBreakdown | undefined;
  /** The detail read failed — the card says so; the rest of the page does not depend on it. */
  failed?: boolean;
  intakes: LedgerIntake[];
  intakesTruncated?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const money = (v: string) => formatUah(v, locale);
  const day = (iso: string) => formatShortDate(iso, locale);
  const shiftDate = shiftDateOf(breakdown, date);
  // A shift left open since an earlier day (#114): every term covers the whole
  // shift, so no row may say «today».
  const spansDays = breakdown?.kind === 'open' && shiftDate !== date;
  const info = buildLedger({ date, shiftDate, intakes, intakesTruncated });

  const body = (): ReactNode => {
    if (failed) {
      return <p className="text-sm text-destructive">{t('common.somethingWentWrong')}</p>;
    }
    if (!breakdown || cash === undefined) {
      return (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      );
    }
    const b = breakdown;
    const c = b.closing;
    const hasTerms = b.kind === 'open' || b.kind === 'closed';

    return (
      <>
        {hasTerms ? (
          <>
            <LedgerRowView
              label={
                spansDays
                  ? t('pointCash.ledger.openingOn', { date: day(shiftDate) })
                  : t('pointCash.ledger.opening')
              }
              value={money(b.opening ?? '0.00')}
            />
            <LedgerRowView
              label={t(spansDays ? 'pointCash.ledger.paidShift' : 'pointCash.ledger.paidToday')}
              value={money(sub('0', b.payouts ?? '0.00'))}
            />
            <LedgerRowView
              label={t('pointCash.ledger.returnedToday')}
              value={money(b.returns ?? '0.00')}
              tone="leaf"
            />
            <LedgerRowView
              label={t(spansDays ? 'pointCash.ledger.cashInShift' : 'pointCash.ledger.cashIn')}
              value={money(b.transfers_in ?? '0.00')}
              tone="leaf"
            />
          </>
        ) : null}

        {b.kind === 'closed' && c ? (
          <>
            {/* Signed so that adding it to the rows above lands on «Мало бути». */}
            {c.late_change && !isZero(c.late_change) ? (
              <LedgerRowView
                label={t('pointCash.ledger.lateChange')}
                value={money(sub('0', c.late_change))}
              />
            ) : null}
            <div className="my-2 border-t border-dashed border-border" />
            <LedgerRowView
              label={t('pointCash.ledger.expected')}
              value={money(c.expected ?? '0.00')}
            />
            <LedgerRowView label={t('pointCash.ledger.counted')} value={money(c.counted)} />
            {/* «Недостача 90,00 ₴» / «Надлишок 50,00 ₴» / «Зійшлося» — the
                shared reading (C7), never a bare signed figure. */}
            <LedgerRowView
              label={t('pointCash.ledger.difference')}
              value={<DiscrepancyText difference={c.difference ?? '0.00'} />}
            />
          </>
        ) : null}

        {b.kind === 'carried' && c && b.anchor_date ? (
          <>
            <LedgerRowView
              label={t('pointCash.ledger.closedOn', { date: day(b.anchor_date) })}
              value={money(c.counted)}
            />
            <p className="pt-1 text-xs text-muted-foreground">{t('day.status.none')}</p>
          </>
        ) : null}

        {b.kind === 'none' ? (
          <p className="pt-1 text-xs text-muted-foreground">{t('pointCash.countHistory.empty')}</p>
        ) : null}

        <div className="my-2 border-t border-border" />
        <LedgerRowView
          label={t(
            b.kind === 'closed' ? 'pointCash.ledger.totalAtClose' : 'pointCash.ledger.total',
          )}
          value={money(cash)}
          strong
          // C9 — one tone rule for cash, the same as the tile above: below
          // zero is amber (a state to fund, not an error), otherwise ink.
          tone={isNegative(cash) ? 'amber' : 'default'}
        />
        {/* R6 — negative berry cash is not a data-entry error; said in words. */}
        {isNegative(cash) ? (
          <p className="pt-1 text-xs text-[var(--amber)]">{t('pointCash.ledger.negative')}</p>
        ) : null}
      </>
    );
  };

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {info.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(
                spansDays && row.key === 'accruedToday'
                  ? 'pointCash.ledger.accruedShift'
                  : `pointCash.ledger.${row.key}`,
              )}
              hint={t(`pointCash.ledger.${row.key}Hint`)}
              value={money(row.value)}
              className="opacity-70"
            />
            {row.truncated ? (
              <p className="pb-1 text-xs text-muted-foreground">
                {t('pointCash.ledger.accruedTodayTruncated')}
              </p>
            ) : null}
          </Fragment>
        ))}
        <div className="my-2 border-b border-dashed border-border" />
        {body()}
      </div>
    </SectionCard>
  );
}
