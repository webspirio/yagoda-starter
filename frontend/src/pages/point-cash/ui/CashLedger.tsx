import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { Spinner } from '@/shared/ui/spinner';
import { sub, cmp, isNegative, isZero, formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import type { PointCashBreakdown } from '@/entities/point-cash';
import {
  buildLedger,
  type LedgerIntake,
  type LedgerPayout,
  type LedgerRowKey,
} from '../lib/buildLedger';

/** The caveat a capped row shows, named for what is actually missing from it. */
const TRUNCATION_KEY: Record<LedgerRowKey, string> = {
  accruedToday: 'pointCash.ledger.accruedTodayTruncated',
  paidPast: 'pointCash.ledger.paidPastTruncated',
};

/**
 * «Звідки взялося це число».
 *
 * EVERY ROW UNDER THE DIVIDER IS THE SERVER'S `breakdown` (#73), read in the
 * same statement as `cash`, so the rows add up by construction: on an open day
 * to `cash` itself, on a closed day to «Мало бути», which the closing count
 * then corrects by the difference. Nothing here re-derives a term of the
 * formula. The two rows ABOVE the divider are informational — berries accrued
 * and payouts of earlier days move no cash today — and are never summed.
 */
export function CashLedger({
  date,
  cash,
  breakdown,
  failed = false,
  intakes,
  payouts,
  intakesTruncated = false,
  payoutsTruncated = false,
  target = null,
}: {
  date: string;
  cash: string | undefined;
  breakdown: PointCashBreakdown | undefined;
  /** The detail read failed — the card says so; the rest of the page does not depend on it. */
  failed?: boolean;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  intakesTruncated?: boolean;
  payoutsTruncated?: boolean;
  /** Captions the opening row: «наділ {{target}}». */
  target?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const money = (v: string) => formatUah(v, locale);
  const day = (iso: string) => formatShortDate(iso, locale);
  const shiftDate =
    breakdown?.kind === 'open' || breakdown?.kind === 'closed'
      ? (breakdown.anchor_date ?? date)
      : date;
  const info = buildLedger({
    date,
    shiftDate,
    intakes,
    payouts,
    intakesTruncated,
    payoutsTruncated,
  });

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
              label={t('pointCash.ledger.opening')}
              hint={
                target ? t('pointCash.ledger.openingHint', { target: money(target) }) : undefined
              }
              value={money(b.opening ?? '0.00')}
            />
            <LedgerRowView
              label={t('pointCash.ledger.paidToday')}
              value={money(sub('0', b.payouts ?? '0.00'))}
            />
            <LedgerRowView
              label={t('pointCash.ledger.returnedToday')}
              value={money(b.returns ?? '0.00')}
              tone="leaf"
            />
            <LedgerRowView
              label={t('pointCash.ledger.cashIn')}
              value={money(b.transfers_in ?? '0.00')}
              tone="leaf"
            />
          </>
        ) : null}

        {b.kind === 'open' && b.anchor_date && b.anchor_date !== date ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {t('pointCash.ledger.openSince', { date: day(b.anchor_date) })}
          </p>
        ) : null}

        {b.kind === 'closed' && c ? (
          <>
            {/* Signed so that adding it to the rows above lands on «Мало бути». */}
            {c.late_change && !isZero(c.late_change) ? (
              <LedgerRowView
                label={t('pointCash.ledger.lateChange')}
                hint={t('pointCash.ledger.lateChangeHint')}
                value={money(sub('0', c.late_change))}
              />
            ) : null}
            <div className="my-2 border-t border-dashed border-border" />
            <LedgerRowView
              label={t('pointCash.ledger.expected')}
              value={money(c.expected ?? '0.00')}
            />
            <LedgerRowView label={t('pointCash.panel.closing')} value={money(c.counted)} />
            <LedgerRowView
              label={t('pointCash.panel.discrepancy')}
              value={signed(money(c.difference ?? '0.00'), c.difference)}
              tone={differenceTone(c.difference)}
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
          tone={isNegative(cash) ? 'bad' : 'default'}
        />
        {/* R6 — negative berry cash is not a data-entry error; said in words. */}
        {isNegative(cash) ? (
          <p className="pt-1 text-xs text-destructive">{t('pointCash.ledger.negative')}</p>
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
              label={t(`pointCash.ledger.${row.key}`)}
              hint={t(`pointCash.ledger.${row.key}Hint`)}
              value={money(row.key === 'paidPast' ? sub('0', row.value) : row.value)}
              className="opacity-70"
            />
            {row.truncated ? (
              <p className="pb-1 text-xs text-muted-foreground">{t(TRUNCATION_KEY[row.key])}</p>
            ) : null}
          </Fragment>
        ))}
        <div className="my-2 border-b border-dashed border-border" />
        {body()}
        <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
          {t('pointCash.ledger.twoRowsNote')}
        </p>
      </div>
    </SectionCard>
  );
}

/** A surplus carries its «+», so it never reads as a shortage by colour alone. */
function signed(formatted: string, difference: string | null): string {
  return difference !== null && cmp(difference, '0') > 0 ? `+${formatted}` : formatted;
}

/** A shortage reads bad, a surplus amber, an exact match plain. */
function differenceTone(difference: string | null): 'bad' | 'amber' | 'default' {
  if (difference === null) return 'default';
  const c = cmp(difference, '0');
  return c < 0 ? 'bad' : c > 0 ? 'amber' : 'default';
}
