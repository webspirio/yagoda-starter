import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cn } from '@/shared/lib/cn';
import { cmp, formatUah, sub, sum } from '@/shared/lib/money';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useCashCountsQuery } from '@/entities/cash-count';
import { usePayoutsQuery } from '@/entities/payout';
import { useIntakesQuery } from '@/entities/intake';
import { useCrateBalancesQuery } from '@/entities/crate';

/**
 * «Стан точки» — what the operator would otherwise have to leave the intake
 * form to look up: the berry drawer and the crates out with people, both
 * read from the SAME reads «Каса точки» and «Ящики» use for themselves.
 * NOTHING here is a second computation of a number those screens already own
 * — every figure is a straight `sum`/`sub` over the live rows of the same
 * entity reads, never re-derived a different way (a second arithmetic path
 * could silently disagree with the first).
 */
export function PointStatePanel({
  pointId,
  shiftId,
  isOwner,
  targetCrates,
}: {
  pointId: string;
  shiftId: string | undefined;
  isOwner: boolean;
  /** `collection_points.target_crates` — `null` means «не задано», never
   *  zero (see `PointOption`'s own doc for why that distinction matters). */
  targetCrates: number | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  // Not gated on the shift being open (unlike the page's own read for
  // «Видано готівкою») — the drawer has a figure whether or not a shift is
  // open today, and this is the one place on the intake screen that says so.
  const cash = usePointCashForPointQuery(pointId);
  const cashCounts = useCashCountsQuery({ shiftId });
  const payouts = usePayoutsQuery({ shiftId });
  const intakes = useIntakesQuery({ shiftId });
  const balances = useCrateBalancesQuery({ pointId, isOwner });

  const openingBerry = (cashCounts.data?.data ?? []).find(
    (row) => row.kind === 'opening' && row.book === 'berry',
  );
  const paidOut = sum(
    (payouts.data?.data ?? []).filter((row) => row.voided_at === null).map((row) => row.amount),
  );
  // «Залишків створено» — Σ (amount − paid_amount) over today's LIVE
  // receipts: what still hangs on a supplier's balance because the drawer
  // could not cover it in full.
  const newDebt = sum(
    (intakes.data?.data ?? [])
      .filter((row) => row.voided_at === null)
      .map((row) => sub(row.amount, row.paid_amount)),
  );
  // A row COUNT, never money — see `entities/crate`'s header for why the two
  // must not mix.
  const outstanding = (balances.data?.data ?? []).reduce(
    (total, row) => total + row.outstanding_units,
    0,
  );

  const pointCashHref = isOwner ? `/point-cash?point=${pointId}` : '/point-cash';
  const cratesHref = isOwner ? `/crates?point=${pointId}` : '/crates';

  return (
    <Card className="h-fit">
      <section className="border-b border-line2 p-4">
        <SectionHead title={t('reception.state.cashTitle')} to={pointCashHref} />
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Tile
            label={t('reception.state.openingCash')}
            value={openingBerry ? formatUah(openingBerry.counted_amount, locale) : '—'}
          />
          <Tile label={t('reception.state.paidOut')} value={formatUah(paidOut, locale)} />
          <Tile
            label={t('reception.state.currentCash')}
            value={cash.data ? formatUah(cash.data.cash, locale) : '…'}
          />
          <Tile
            label={t('reception.state.newDebt')}
            value={formatUah(newDebt, locale)}
            tone={cmp(newDebt, '0') === 1 ? 'amber' : undefined}
          />
        </div>
      </section>

      <section className="p-4">
        <SectionHead title={t('reception.state.cratesTitle')} to={cratesHref} />
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Tile
            label={t('reception.state.allotment')}
            value={
              targetCrates === null
                ? t('reception.state.allotmentUnset')
                : t('reception.state.allotmentValue', { count: targetCrates })
            }
          />
          <Tile label={t('reception.state.inField')} value={String(outstanding)} />
        </div>
        {/* D-3: the mock's allotment-vs-outstanding proportion bar
            (`CrateStandingBar`) is not built here — this panel prints the
            two figures side by side and stops there; see the mock-parity
            decision register. */}
      </section>
    </Card>
  );
}

/**
 * A section's label with a way back into the screen that actually manages
 * this state — the operator looks here, acts there. `Eyebrow` from
 * `shared/ui`; the mock's own `SectionHead` kit piece does not exist in this
 * codebase, so this is a small local header rather than a new shared/ui
 * addition for a single caller.
 */
function SectionHead({ title, to }: { title: string; to: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <Eyebrow>{title}</Eyebrow>
      <Link to={to} className="text-xs font-medium text-brand hover:underline">
        {t('reception.state.open')}
      </Link>
    </div>
  );
}

/** One grid cell. The value arrives already formatted — nothing here computes. */
function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'amber' | 'bad';
}) {
  return (
    <div className="min-w-0">
      <Eyebrow className="truncate">{label}</Eyebrow>
      <div
        className={cn(
          'mt-1 truncate font-mono text-xl leading-none font-semibold tracking-tight',
          tone === 'amber' && 'text-amber',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}
