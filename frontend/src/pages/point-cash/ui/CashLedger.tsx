import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { Spinner } from '@/shared/ui/spinner';
import { TraceTerm, type TraceTone } from '@/shared/ui/trace';
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
 *
 * TRACED (client, 24.10): every row value is a `data-trace` source, and the
 * line under the total spells the sum out in `TraceTerm`s — on an open day
 * «на початок − видано + повернуто + прийнято = у касі» (the total also lights
 * the page's «У касі за ягоду» tile, `cash:total`), on a closed day the same
 * rows «= мало бути». The page's `TraceScope` holds both.
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

  const openingLabel = spansDays
    ? t('pointCash.ledger.openingOn', { date: day(shiftDate) })
    : t('pointCash.ledger.opening');

  /**
   * The rows above, added up in one line of boxed operands. Only where the
   * rows really add up to a figure on screen: an open day's to `cash`, a
   * closed day's to «Мало бути» (null on a day closed with no stored
   * expectation — then there is nothing to add up to).
   */
  const formula = (b: PointCashBreakdown, total: string): ReactNode => {
    const c = b.closing;
    const result =
      b.kind === 'open'
        ? {
            value: total,
            refs: ['ledger:total', 'cash:total'],
            hint: t('pointCash.ledger.traceTotal'),
            tone: (isNegative(total) ? 'amber' : 'neutral') as TraceTone,
          }
        : b.kind === 'closed' && c?.expected != null
          ? {
              value: c.expected,
              refs: ['ledger:expected'],
              hint: t('pointCash.ledger.expected'),
              tone: 'neutral' as TraceTone,
            }
          : null;
    if (!result) return null;
    // A signed term is written with its own operator and an unsigned figure,
    // so the line never reads «+ −90,00 ₴».
    const late =
      b.kind === 'closed' && c?.late_change && !isZero(c.late_change)
        ? sub('0', c.late_change)
        : null;
    const terms: { ref: string; op: '−' | '+'; value: string; hint: string; tone: TraceTone }[] = [
      {
        ref: 'ledger:paid',
        op: '−',
        value: b.payouts ?? '0.00',
        hint: t(spansDays ? 'pointCash.ledger.paidShift' : 'pointCash.ledger.paidToday'),
        tone: 'neutral',
      },
      {
        ref: 'ledger:returned',
        op: '+',
        value: b.returns ?? '0.00',
        hint: t('pointCash.ledger.returnedToday'),
        tone: 'leaf',
      },
      {
        ref: 'ledger:transfersIn',
        op: '+',
        value: b.transfers_in ?? '0.00',
        hint: t(spansDays ? 'pointCash.ledger.cashInShift' : 'pointCash.ledger.cashIn'),
        tone: 'leaf',
      },
      ...(late
        ? [
            {
              ref: 'ledger:lateChange',
              op: isNegative(late) ? ('−' as const) : ('+' as const),
              value: isNegative(late) ? sub('0', late) : late,
              hint: t('pointCash.ledger.lateChange'),
              tone: 'neutral' as TraceTone,
            },
          ]
        : []),
    ];
    return (
      <p
        data-ledger-formula
        className="flex flex-wrap items-baseline gap-x-1 gap-y-1 pt-2 text-xs text-muted-foreground"
      >
        <TraceTerm refs="ledger:opening" hint={openingLabel}>
          {money(b.opening ?? '0.00')}
        </TraceTerm>
        {terms.map((term) => (
          <Fragment key={term.ref}>
            <span>{term.op}</span>
            <TraceTerm refs={term.ref} tone={term.tone} hint={term.hint}>
              {money(term.value)}
            </TraceTerm>
          </Fragment>
        ))}
        <span>=</span>
        <TraceTerm refs={result.refs} tone={result.tone} hint={result.hint}>
          {money(result.value)}
        </TraceTerm>
      </p>
    );
  };

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
              label={openingLabel}
              value={<span data-trace="ledger:opening">{money(b.opening ?? '0.00')}</span>}
            />
            <LedgerRowView
              label={t(spansDays ? 'pointCash.ledger.paidShift' : 'pointCash.ledger.paidToday')}
              value={<span data-trace="ledger:paid">{money(sub('0', b.payouts ?? '0.00'))}</span>}
            />
            <LedgerRowView
              label={t('pointCash.ledger.returnedToday')}
              value={<span data-trace="ledger:returned">{money(b.returns ?? '0.00')}</span>}
              tone="leaf"
            />
            <LedgerRowView
              label={t(spansDays ? 'pointCash.ledger.cashInShift' : 'pointCash.ledger.cashIn')}
              value={<span data-trace="ledger:transfersIn">{money(b.transfers_in ?? '0.00')}</span>}
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
                value={<span data-trace="ledger:lateChange">{money(sub('0', c.late_change))}</span>}
              />
            ) : null}
            <div className="my-2 border-t border-dashed border-border" />
            <LedgerRowView
              label={t('pointCash.ledger.expected')}
              value={
                c.expected == null ? (
                  '—'
                ) : (
                  <span data-trace="ledger:expected">{money(c.expected)}</span>
                )
              }
            />
            <LedgerRowView label={t('pointCash.ledger.counted')} value={money(c.counted)} />
            {/* «Недостача 90,00 ₴» / «Надлишок 50,00 ₴» / «Зійшлося» — the
                shared reading (C7), never a bare signed figure. A day closed
                with no stored expectation has no difference to read: «—»,
                never «Зійшлося» over a null. */}
            <LedgerRowView
              label={t('pointCash.ledger.difference')}
              value={c.difference == null ? '—' : <DiscrepancyText difference={c.difference} />}
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
          value={<span data-trace="ledger:total">{money(cash)}</span>}
          strong
          // C9 — one tone rule for cash, the same as the tile above: below
          // zero is amber (a state to fund, not an error), otherwise ink.
          tone={isNegative(cash) ? 'amber' : 'default'}
        />
        {/* R6 — negative berry cash is not a data-entry error; said in words. */}
        {isNegative(cash) ? (
          <p className="pt-1 text-xs text-[var(--amber)]">{t('pointCash.ledger.negative')}</p>
        ) : null}
        {formula(b, cash)}
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
