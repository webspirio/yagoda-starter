import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah } from '@/shared/lib/money';
import type {
  NetworkCostOfDay,
  NetworkCostPoint,
  NetworkCostProduct,
} from '@/entities/cost-of-day';
import { AMBER, LEAF, NUM, PLUM, SKY, STICKY, ShortfallValue } from './CostTableRow';

const COLUMNS = 11;

/**
 * «Усі точки» (spec 2026-10-23-cost-of-day-all-points §4): the single-point
 * table's bands in the same order, but the недостача and витрати halves are
 * MONEY here, not ₴/кг — a per-kilogram half differs from point to point, so
 * one network column of them would be a mean nobody can re-check. The row
 * reads as two formulas, both printed under it when opened:
 *
 *   нараховано − своя + частка недостачі + частка витрат = повна вартість
 *   повна вартість ÷ база = собівартість                (§8.6: сума ÷ вага)
 *
 * Every figure is the server's — sums included. A point's sub-row carries
 * that point's own собівартість, exactly as its page prints it.
 */
export function NetworkCostTable({ day, locale }: { day: NetworkCostOfDay; locale: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (productId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const w = day.weighed;
  const dec = (s: string) => formatDecimal(s, locale);
  const dash = (v: string | null | undefined, f: (s: string) => string = dec) =>
    v === null || v === undefined ? '—' : f(v);
  const anyUnweighed = day.products.some((p) => p.points.some((c) => !c.complete));
  // Counting points is not arithmetic on money: «з 1 точки з 6» (audit E1).
  const weighedPoints = day.points.filter((p) => p.weighed).length;

  const group = (label: string, span: number, tone: string) => (
    <TableHead
      scope="colgroup"
      colSpan={span}
      className={`border-b-2 text-center text-xs uppercase tracking-wide ${tone}`}
    >
      {label}
    </TableHead>
  );

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line2">
        <Table className="[&_td]:px-3 [&_th]:h-auto [&_th]:px-3 [&_th]:py-2 [&_th]:leading-tight [&_th]:whitespace-normal">
          <TableHeader>
            <TableRow>
              <TableHead className={STICKY} />
              {group(t('costOfDay.table.groupWeight'), 3, 'border-foreground/40')}
              {group(
                t('costOfDay.table.groupPurchase'),
                2,
                `${SKY} border-[var(--sky)] text-[var(--sky)]`,
              )}
              {group(
                t('costOfDay.table.groupShortfall'),
                2,
                `${AMBER} border-[var(--amber)] text-[var(--amber)]`,
              )}
              {group(t('costOfDay.table.groupExpenses'), 1, `${PLUM} border-[var(--plum)]`)}
              {group(
                t('costOfDay.table.groupResult'),
                2,
                `${LEAF} border-[var(--leaf)] text-[var(--leaf)]`,
              )}
            </TableRow>
            <TableRow>
              <TableHead scope="col" className={STICKY}>
                {t('costOfDay.table.product')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.table.point')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.table.base')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.table.notArrived')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${SKY}`}>
                {t('costOfDay.table.accrued')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${SKY}`}>
                {t('costOfDay.table.priceWas')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${AMBER}`}>
                {t('costOfDay.table.ownShortfall')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${AMBER}`}>
                {t('costOfDay.network.table.share')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${PLUM}`}>
                {t('costOfDay.network.table.share')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${LEAF}`}>
                {t('costOfDay.network.table.fullCost')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${LEAF}`}>
                {t('costOfDay.network.table.cost')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {day.products.map((p) => (
              <ProductRows
                key={p.product_id}
                product={p}
                open={expanded.has(p.product_id)}
                onToggle={() => toggle(p.product_id)}
                locale={locale}
              />
            ))}

            {/* Sums only, over the rows weighed in full; «—» until anything is. */}
            <TableRow data-total className="border-t-2 border-border font-semibold">
              <TableCell className={STICKY}>{t('costOfDay.table.total')}</TableCell>
              <TableCell className={NUM}>{dash(w?.intake_kg)}</TableCell>
              <TableCell className={NUM}>{w === null ? '—' : dec(day.reweighed_kg)}</TableCell>
              <TableCell className={NUM}>
                <ShortfallValue value={w?.shortfall_kg ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${SKY}`}>{dash(w?.accrued)}</TableCell>
              <TableCell className={SKY} />
              <TableCell className={`${NUM} ${AMBER}`}>
                <ShortfallValue value={w?.shortfall ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${AMBER}`}>
                <ShortfallValue value={w?.shortfall_share ?? null} locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${PLUM}`}>{dash(w?.expenses_share)}</TableCell>
              <TableCell className={`${NUM} ${LEAF}`}>{dash(w?.full_cost)}</TableCell>
              <TableCell className={LEAF} />
            </TableRow>

            {anyUnweighed ? (
              <TableRow className="text-muted-foreground hover:bg-transparent">
                <TableCell colSpan={COLUMNS} className="text-xs whitespace-normal">
                  {t('costOfDay.table.unweighed', {
                    kg: formatKg(day.unweighed.intake_kg, locale),
                    amount: formatUah(day.unweighed.accrued, locale),
                  })}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {w !== null && day.price_cost_avg !== null ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
          {/* The server's `weighed.full_cost` IS this numerator, exactly. */}
          <p data-day-formula className="text-sm text-foreground">
            <Trans
              t={t}
              i18nKey={
                // Some points' нараховано is not in this numerator — say so (E3).
                anyUnweighed ? 'costOfDay.table.dayFormulaWeighed' : 'costOfDay.table.dayFormula'
              }
              values={{
                accrued: dec(w.accrued),
                expenses: dec(day.expenses_weighed),
                kg: formatKg(day.reweighed_kg, locale),
                avg: dec(day.price_cost_avg),
              }}
              components={{
                leaf: <span className="font-mono font-semibold text-[var(--leaf)]" />,
              }}
            />
          </p>
          {/* The day's kilograms come from the points that weighed — a
              figure that reads like the network's must say how much of the
              network it is (audit E1). */}
          {weighedPoints < day.points.length ? (
            <p data-counted>
              {t('costOfDay.network.counted', {
                kg: formatKg(day.reweighed_kg, locale),
                count: weighedPoints,
                total: day.points.length,
              })}
            </p>
          ) : null}
          <p>{t('costOfDay.network.rule')}</p>
        </div>
      ) : (
        <div data-awaiting className="mt-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t('costOfDay.expenses.awaiting')}</p>
          <p className="text-xs">{t('costOfDay.expenses.awaitingNote')}</p>
        </div>
      )}
    </div>
  );
}

/** A product's network row, then — opened — its two formulas and one sub-row per point. */
function ProductRows({
  product: p,
  open,
  onToggle,
  locale,
}: {
  product: NetworkCostProduct;
  open: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const dec = (s: string) => formatDecimal(s, locale);
  const counted = p.points.filter((c) => c.complete).map((c) => c.point_name);
  const left = p.points.filter((c) => !c.complete).map((c) => c.point_name);

  return (
    <>
      <FigureRow
        figures={p}
        locale={locale}
        label={
          <>
            <button
              type="button"
              aria-expanded={open}
              aria-label={t(
                open ? 'costOfDay.network.hidePoints' : 'costOfDay.network.showPoints',
                { product: p.product_name },
              )}
              onClick={onToggle}
              className="print-hide -ml-1 mr-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground align-middle hover:text-foreground"
            >
              <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {p.product_name}
            {p.complete ? null : (
              <Badge variant="outline" className="ml-1.5 font-normal">
                {t('costOfDay.berry.notReweighed')}
              </Badge>
            )}
            {/* Weighed at SOME points: the row is theirs, not the network's
                (audit E1) — say how many, and what it leaves out. */}
            {p.complete && p.unweighed !== null ? (
              <>
                <Badge variant="outline" className="ml-1.5 font-normal">
                  {t('costOfDay.network.partial', { n: counted.length, count: p.points.length })}
                </Badge>
                <div className="pl-5 text-xs font-normal text-muted-foreground">
                  {t('costOfDay.network.partialWithout', {
                    kg: formatKg(p.unweighed.intake_kg, locale),
                  })}
                </div>
              </>
            ) : null}
          </>
        }
        strong
      />

      {open ? (
        <TableRow className="bg-muted/40 text-muted-foreground hover:bg-muted/40">
          <TableCell colSpan={COLUMNS} className="!pl-9 text-xs whitespace-normal">
            <ul data-chain className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums">
              {p.full_cost !== null && p.shortfall_share !== null && p.expenses_share !== null ? (
                <li>
                  {t('costOfDay.network.chain.full', {
                    accrued: dec(p.accrued),
                    shortfall: dec(p.shortfall),
                    shortfallShare: dec(p.shortfall_share),
                    expensesShare: dec(p.expenses_share),
                    full: dec(p.full_cost),
                  })}
                </li>
              ) : null}
              {p.full_cost !== null && p.reweigh_net_kg !== null && p.price_cost !== null ? (
                <li>
                  {t('costOfDay.network.chain.cost', {
                    full: dec(p.full_cost),
                    kg: dec(p.reweigh_net_kg),
                    cost: dec(p.price_cost),
                    names: counted.join(', '),
                  })}
                </li>
              ) : null}
              {p.unweighed !== null ? (
                <li>
                  {t('costOfDay.network.chain.unweighed', {
                    names: left.join(', '),
                    kg: formatKg(p.unweighed.intake_kg, locale),
                    amount: formatUah(p.unweighed.accrued, locale),
                  })}
                </li>
              ) : null}
            </ul>
          </TableCell>
        </TableRow>
      ) : null}

      {open
        ? p.points.map((c) => (
            <FigureRow
              key={c.shift_id}
              figures={c}
              locale={locale}
              muted
              label={
                <>
                  {c.point_name}
                  {c.complete ? null : (
                    <Badge variant="outline" className="ml-1.5 font-normal">
                      {t('costOfDay.berry.notReweighed')}
                    </Badge>
                  )}
                </>
              }
            />
          ))
        : null}
    </>
  );
}

/** One line of figures — a product's network row or one point's sub-row; the
 *  two carry the same fields, so they print through the same cells. */
function FigureRow({
  figures: f,
  label,
  locale,
  strong = false,
  muted = false,
}: {
  figures: NetworkCostProduct | NetworkCostPoint;
  label: ReactNode;
  locale: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const dec = (s: string) => formatDecimal(s, locale);
  const dash = (v: string | null, fmt: (s: string) => string = dec) => (v === null ? '—' : fmt(v));
  // `complete` false: no недостача has been established — «—», never a zero.
  const weighed = f.complete;

  return (
    <TableRow
      data-muted={muted || undefined}
      className={muted ? 'bg-muted/40 text-muted-foreground' : ''}
    >
      <TableCell className={`${STICKY} ${muted ? '!pl-9' : 'font-medium'}`}>{label}</TableCell>
      <TableCell className={NUM}>{dec(f.intake_net_kg)}</TableCell>
      <TableCell className={NUM}>{dash(f.reweigh_net_kg)}</TableCell>
      <TableCell className={NUM}>
        <ShortfallValue value={weighed ? f.shortfall_kg : null} minus locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${SKY}`}>
        {dec(f.accrued)}
        {f.top_ups !== '0.00' ? (
          <div className="text-xs font-normal text-muted-foreground">
            <TopUps value={f.top_ups} locale={locale} />
          </div>
        ) : null}
      </TableCell>
      <TableCell className={`${NUM} ${SKY} ${muted ? '' : 'text-[var(--sky)]'}`}>
        {dec(f.price_was)}
      </TableCell>
      <TableCell className={`${NUM} ${AMBER}`}>
        <ShortfallValue value={weighed ? f.shortfall : null} minus locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${AMBER}`}>
        <ShortfallValue value={f.shortfall_share} locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${PLUM}`}>{dash(f.expenses_share)}</TableCell>
      <TableCell className={`${NUM} ${LEAF}`}>{dash(f.full_cost)}</TableCell>
      <TableCell
        className={`${NUM} ${LEAF} ${strong ? 'text-base font-bold text-[var(--leaf)]' : ''}`}
      >
        {dash(f.price_cost)}
      </TableCell>
    </TableRow>
  );
}

function TopUps({ value, locale }: { value: string; locale: string }) {
  const { t } = useTranslation();
  return <>{t('costOfDay.table.topUps', { amount: formatDecimal(value, locale) })}</>;
}
