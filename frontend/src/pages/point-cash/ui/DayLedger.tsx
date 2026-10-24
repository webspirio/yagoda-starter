import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { TraceTerm, type TraceTone } from '@/shared/ui/trace';
import { cn } from '@/shared/lib/cn';
import { sub, cmp, isZero, formatUah } from '@/shared/lib/money';
import type { DaySummary } from '../lib/daySummary';

type Op = '−' | '+' | null;

/** A voided payout still out of the drawer: the ledger's own row and the feed's voided payouts. */
const VOIDED_REFS = ['day:voided', 'feed:voidedPayout'] as const;

/**
 * One term of the equation: the operator in its own column, the label, the
 * UNSIGNED value. The sign lives in the operator, never in the figure, so a
 * column of numbers never reads «−4 000,00» next to a «+».
 */
function Term({
  op,
  label,
  hint,
  value,
  refs,
  trace,
  tone = 'default',
  strong = false,
}: {
  op: Op;
  label: string;
  hint?: ReactNode;
  value: string;
  /** Where the figure is shown: the day's tile, the feed rows it sums. */
  refs: readonly string[];
  /** The term's tooltip — names those sources. */
  trace: string;
  tone?: 'default' | 'amber';
  strong?: boolean;
}) {
  const traceTone: TraceTone = tone === 'amber' ? 'amber' : 'neutral';
  return (
    <div
      data-term
      className={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1 text-sm',
        strong && 'font-semibold',
      )}
    >
      <span className="font-mono text-muted-foreground">{op}</span>
      <span className={cn(!strong && 'text-muted-foreground')}>
        {label}
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <TraceTerm
        refs={refs}
        tone={traceTone}
        hint={trace}
        className={cn('justify-self-end', tone !== 'amber' && 'text-foreground')}
      >
        {value}
      </TraceTerm>
    </div>
  );
}

/**
 * «Звірка каси» — the day's cash out, read as ONE equation whose visible terms
 * produce the figure on the plaque (audit 2026-10-24, C2):
 *
 *     Нараховано за ягоду цього дня        23 986,00
 *   − Пішло в залишок за нами              19 986,00
 *   + Анульовані, гроші ще не в касі          (only when there are any)
 *   = Разом вийшло з каси                   4 000,00
 *     з них: одразу з квитанцією … · без ягоди 4 000,00 · за анульованими …
 *
 * It holds by construction: `debtGrowth = accrued − live payouts`
 * (`buildDaySummary`), and `cashOut = live payouts + voidedOut` — a live
 * payout is never «back in the drawer». On a day that paid down old balances
 * `debtGrowth` is negative and the term flips to «+ Видано понад нараховане».
 * The «з них» line splits the SAME total by kind, so it adds up too.
 *
 * The old layout printed «accrued − with a receipt − without berry − debt
 * growth» (a decomposition of the accrued sum to zero) above a plaque showing
 * the cash out — four rows whose figures produced nothing on screen.
 *
 * TRACED (client, 24.10): every figure is a `TraceTerm` lighting the day's
 * tile that shows it (`day:*`, `DayTiles`) and the feed rows it sums
 * (`feed:*`, `DayFeed`) — the page's `TraceScope` holds all three.
 *
 * `topUps` — the owner's доплати on this shift's receipts, read off
 * «Собівартість дня» (owner only). They move no cash, so they are not in this
 * equation, while cost-of-day's «Нараховано» includes them; the note says so
 * on the days it matters, and says nothing otherwise (top-ups review, item 5).
 */
export function DayLedger({
  summary,
  truncated,
  topUps = null,
}: {
  summary: DaySummary;
  truncated: boolean;
  topUps?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const money = (v: string) => formatUah(v, locale);
  const { paidDown } = summary;
  const hasVoided = !isZero(summary.voidedOut);

  const voidedHint = !hasVoided
    ? undefined
    : isZero(summary.voidedNotReturned)
      ? t('day.ledger.voidedReturned')
      : // Equal sums mean «none came back» only because no payout is 0,00
        // (`CHK_payouts_amount`, `amount > 0`); a returned zero would
        // otherwise leave them equal too.
        cmp(summary.voidedNotReturned, summary.voidedOut) === 0
        ? t('day.ledger.voidedNoneReturned')
        : t('day.ledger.voidedNotReturned', { notReturned: money(summary.voidedNotReturned) });

  // The plaque's total split by kind — only the parts that are there. Each part
  // lights the feed rows it sums.
  const parts = [
    {
      key: 'partAtReception',
      value: summary.paidAtReception,
      refs: ['feed:atReception'],
      trace: t('day.ledger.trace.atReception'),
    },
    {
      key: 'partWithoutBerry',
      value: summary.paidWithoutBerry,
      refs: ['feed:withoutBerry'],
      trace: t('day.ledger.trace.withoutBerry'),
    },
    {
      key: 'partVoided',
      value: summary.voidedOut,
      refs: VOIDED_REFS,
      trace: t('day.ledger.trace.voided'),
    },
  ].filter((p) => !isZero(p.value));

  return (
    <SectionCard eyebrow={t('day.ledger.title')}>
      <div className="flex flex-col">
        <Term
          op={null}
          label={t('day.ledger.accrued')}
          value={money(summary.accrued)}
          refs={['day:accrued', 'feed:intake']}
          trace={t('day.ledger.trace.accrued')}
          strong
        />
        {paidDown ? (
          <Term
            op="+"
            label={t('day.ledger.debtPaidDown')}
            hint={t('day.ledger.debtPaidDownHint')}
            value={money(sub('0', summary.debtGrowth))}
            refs={['day:debt']}
            trace={t('day.ledger.trace.debtPaidDown')}
          />
        ) : (
          <Term
            op="−"
            label={t('day.ledger.debtCreated')}
            value={money(summary.debtGrowth)}
            refs={['day:debt']}
            trace={t('day.ledger.trace.debtCreated')}
            tone={isZero(summary.debtGrowth) ? 'default' : 'amber'}
          />
        )}
        {hasVoided ? (
          <Term
            op="+"
            label={t('day.ledger.voided')}
            hint={voidedHint}
            value={money(summary.voidedOut)}
            refs={VOIDED_REFS}
            trace={t('day.ledger.trace.voided')}
          />
        ) : null}
      </div>

      <div
        data-term
        className="mt-3 grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg bg-foreground px-4 py-3 text-background"
      >
        <span className="font-mono">=</span>
        <span className="text-sm font-medium">{t('day.ledger.cashOut')}</span>
        {/* On the ink plaque the term inverts its box, so it still reads as one. */}
        <TraceTerm
          refs={['day:cashOut']}
          hint={t('day.ledger.trace.cashOut')}
          className="justify-self-end border-background/30 bg-background/10 text-xl font-semibold text-background"
        >
          {money(summary.cashOut)}
        </TraceTerm>
      </div>
      {parts.length > 0 ? (
        <p className="mt-2 pl-[calc(1.25rem+0.5rem)] text-xs text-muted-foreground">
          {t('day.ledger.ofWhich')}{' '}
          {parts.map((p, n) => (
            <span key={p.key}>
              {n > 0 ? ' · ' : null}
              {t(`day.ledger.${p.key}`)}{' '}
              <TraceTerm refs={p.refs} hint={p.trace}>
                {money(p.value)}
              </TraceTerm>
            </span>
          ))}
        </p>
      ) : null}

      {truncated ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('day.ledger.truncated')}</p>
      ) : null}
      {topUps !== null && !isZero(topUps) ? (
        <p data-top-ups-note className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t('day.ledger.topUps', { amount: money(topUps) })}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('day.ledger.note')}</p>
    </SectionCard>
  );
}
