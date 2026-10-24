import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import {
  formatDecimal,
  formatKg,
  formatUah,
  formatUahPerKg,
  unbreakable,
} from '@/shared/lib/money';
import type {
  NetworkCostOfDay,
  NetworkCostPoint,
  NetworkCostProduct,
} from '@/entities/cost-of-day';
import { AMBER, LEAF, NUM, PLUM, SKY, STICKY, ShortfallValue, TopUpsNote } from './CostTableRow';
import {
  DAY,
  TOTAL,
  UNWEIGHED,
  pointExpensesId,
  pointRowId,
  rowId,
  type RowField,
} from './trace-ids';
import { ShortfallTerm, Term } from './terms';

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
  // A formula's operands carry their units and never break inside one.
  const uah = (s: string) => unbreakable(formatUah(s, locale));
  const kg = (s: string) => unbreakable(formatKg(s, locale));
  const perKg = (s: string) => unbreakable(formatUahPerKg(s, locale));
  // Counting points is not arithmetic on money: «з 1 точки з 6» (audit E1).
  const weighedPoints = day.points.filter((p) => p.weighed).length;
  // The expenses the day formula spreads are the weighed points' entries in
  // the expenses line above the table, and the «Частка» total under «Витрати».
  const spreadExpenses = [
    TOTAL.expensesShare,
    ...day.points.filter((p) => p.weighed).map((p) => pointExpensesId(p.shift_id)),
  ];
  const totalCell = (column: string) =>
    t('costOfDay.trace.cell', { column, row: t('costOfDay.table.total') });

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
              <TableCell className={NUM} data-trace={TOTAL.intakeKg}>
                {dash(w?.intake_kg)}
              </TableCell>
              <TableCell className={NUM} data-trace={DAY.baseKg}>
                {w === null ? '—' : dec(day.reweighed_kg)}
              </TableCell>
              <TableCell className={NUM} data-trace={TOTAL.shortKg}>
                <ShortfallValue value={w?.shortfall_kg ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${SKY}`} data-trace={TOTAL.accrued}>
                {dash(w?.accrued)}
              </TableCell>
              <TableCell className={SKY} />
              <TableCell className={`${NUM} ${AMBER}`} data-trace={TOTAL.shortfall}>
                <ShortfallValue value={w?.shortfall ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${AMBER}`} data-trace={TOTAL.shortfallShare}>
                <ShortfallValue value={w?.shortfall_share ?? null} locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${PLUM}`} data-trace={TOTAL.expensesShare}>
                {dash(w?.expenses_share)}
              </TableCell>
              <TableCell className={`${NUM} ${LEAF}`} data-trace={TOTAL.full}>
                {dash(w?.full_cost)}
              </TableCell>
              <TableCell className={LEAF} />
            </TableRow>

            {anyUnweighed ? (
              <TableRow className="text-muted-foreground hover:bg-transparent">
                <TableCell colSpan={COLUMNS} className="text-xs whitespace-normal">
                  <Trans
                    t={t}
                    i18nKey="costOfDay.table.unweighed"
                    values={{
                      kg: kg(day.unweighed.intake_kg),
                      amount: uah(day.unweighed.accrued),
                    }}
                    components={{
                      kg: (
                        <Term
                          refs={UNWEIGHED.intakeKg}
                          hint={t('costOfDay.trace.unweighed', {
                            column: t('costOfDay.table.point'),
                          })}
                        />
                      ),
                      amount: (
                        <Term
                          refs={UNWEIGHED.accrued}
                          tone="sky"
                          hint={t('costOfDay.trace.unweighed', {
                            column: t('costOfDay.table.accrued'),
                          })}
                        />
                      ),
                    }}
                  />
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
                accrued: uah(w.accrued),
                expenses: uah(day.expenses_weighed),
                kg: kg(day.reweighed_kg),
                avg: perKg(day.price_cost_avg),
              }}
              components={{
                accrued: (
                  <Term
                    refs={TOTAL.accrued}
                    tone="sky"
                    hint={totalCell(t('costOfDay.table.accrued'))}
                  />
                ),
                expenses: (
                  <Term
                    refs={spreadExpenses}
                    tone="plum"
                    hint={t('costOfDay.trace.expensesSpread', {
                      column: `${t('costOfDay.table.groupExpenses')} · ${t('costOfDay.network.table.share')}`,
                    })}
                  />
                ),
                kg: <Term refs={DAY.baseKg} hint={totalCell(t('costOfDay.table.base'))} />,
                // Shown nowhere else: it points at the total row it is made of.
                avg: (
                  <Term
                    refs={[TOTAL.full, TOTAL.accrued, DAY.baseKg, ...spreadExpenses]}
                    tone="leaf"
                    hint={totalCell(t('costOfDay.network.table.fullCost'))}
                    className="font-semibold"
                  />
                ),
              }}
            />
          </p>
          {/* The day's kilograms come from the points that weighed — a
              figure that reads like the network's must say how much of the
              network it is (audit E1). */}
          {weighedPoints < day.points.length ? (
            <p data-counted>
              <Trans
                t={t}
                i18nKey="costOfDay.network.counted"
                count={weighedPoints}
                values={{ kg: kg(day.reweighed_kg), total: day.points.length }}
                components={{
                  kg: <Term refs={DAY.baseKg} hint={totalCell(t('costOfDay.table.base'))} />,
                }}
              />
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
  const uah = (s: string) => unbreakable(formatUah(s, locale));
  const kg = (s: string) => unbreakable(formatKg(s, locale));
  const counted = p.points.filter((c) => c.complete).map((c) => c.point_name);
  const left = p.points.filter((c) => !c.complete).map((c) => c.point_name);
  // Every operand points at the cell of this product's row it was read from.
  const id = (field: RowField) => rowId(p.product_id, field);
  const cell = (column: string) => t('costOfDay.trace.cell', { column, row: p.product_name });
  const col = {
    accrued: t('costOfDay.table.accrued'),
    own: t('costOfDay.table.ownShortfall'),
    shortfallShare: `${t('costOfDay.table.groupShortfall')} · ${t('costOfDay.network.table.share')}`,
    expensesShare: `${t('costOfDay.table.groupExpenses')} · ${t('costOfDay.network.table.share')}`,
    full: t('costOfDay.network.table.fullCost'),
    base: t('costOfDay.table.base'),
    cost: t('costOfDay.network.table.cost'),
  };
  // «без 100,00 кг» and the «не перезважено» step: the sub-rows of the points
  // that have not weighed this product.
  const leftHint = (column: string) =>
    t('costOfDay.trace.unweighed', { column: `${column} · ${p.product_name}` });

  return (
    <>
      <FigureRow
        figures={p}
        locale={locale}
        rowLabel={p.product_name}
        trace={(field) =>
          // A product nobody weighed in full is wholly in the «не перезважено» line.
          !p.complete && field === 'intakeKg'
            ? `${id(field)} ${UNWEIGHED.intakeKg}`
            : !p.complete && field === 'accrued'
              ? `${id(field)} ${UNWEIGHED.accrued}`
              : id(field)
        }
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
                  <Trans
                    t={t}
                    i18nKey="costOfDay.network.partialWithout"
                    values={{ kg: kg(p.unweighed.intake_kg) }}
                    components={{
                      kg: (
                        <Term
                          refs={id('unweighedKg')}
                          hint={leftHint(t('costOfDay.table.point'))}
                        />
                      ),
                    }}
                  />
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
                  <Trans
                    t={t}
                    i18nKey="costOfDay.network.chain.full"
                    values={{
                      accrued: uah(p.accrued),
                      shortfall: uah(p.shortfall),
                      shortfallShare: uah(p.shortfall_share),
                      expensesShare: uah(p.expenses_share),
                      full: uah(p.full_cost),
                    }}
                    components={{
                      accrued: <Term refs={id('accrued')} tone="sky" hint={cell(col.accrued)} />,
                      shortfall: <ShortfallTerm refs={id('shortfall')} hint={cell(col.own)} />,
                      shortfallShare: (
                        <ShortfallTerm
                          refs={id('shortfallShare')}
                          hint={cell(col.shortfallShare)}
                        />
                      ),
                      expensesShare: (
                        <Term
                          refs={id('expensesShare')}
                          tone="plum"
                          hint={cell(col.expensesShare)}
                        />
                      ),
                      full: <Term refs={id('full')} tone="leaf" hint={cell(col.full)} />,
                    }}
                  />
                </li>
              ) : null}
              {p.full_cost !== null && p.reweigh_net_kg !== null && p.price_cost !== null ? (
                <li>
                  <Trans
                    t={t}
                    i18nKey="costOfDay.network.chain.cost"
                    values={{
                      full: uah(p.full_cost),
                      kg: kg(p.reweigh_net_kg),
                      cost: unbreakable(formatUahPerKg(p.price_cost, locale)),
                    }}
                    components={{
                      full: <Term refs={id('full')} tone="leaf" hint={cell(col.full)} />,
                      kg: <Term refs={id('baseKg')} hint={cell(col.base)} />,
                      cost: <Term refs={id('cost')} tone="leaf" hint={cell(col.cost)} />,
                      // Point names are the owner's text: React children, never markup.
                      names: <>{counted.join(', ')}</>,
                    }}
                  />
                </li>
              ) : null}
              {p.unweighed !== null ? (
                <li>
                  <Trans
                    t={t}
                    i18nKey="costOfDay.network.chain.unweighed"
                    values={{
                      kg: kg(p.unweighed.intake_kg),
                      amount: uah(p.unweighed.accrued),
                    }}
                    components={{
                      names: <>{left.join(', ')}</>,
                      kg: (
                        <Term
                          refs={id('unweighedKg')}
                          hint={leftHint(t('costOfDay.table.point'))}
                        />
                      ),
                      amount: (
                        <Term
                          refs={id('unweighedAccrued')}
                          tone="sky"
                          hint={leftHint(t('costOfDay.table.accrued'))}
                        />
                      ),
                    }}
                  />
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
              rowLabel={`${p.product_name} · ${c.point_name}`}
              trace={(field) => {
                const own = pointRowId(p.product_id, c.shift_id, field);
                // A point that has not weighed the product is one of the cells
                // its «не перезважено» step — and the day's line — sum.
                if (c.complete) return own;
                if (field === 'intakeKg')
                  return `${own} ${id('unweighedKg')} ${UNWEIGHED.intakeKg}`;
                if (field === 'accrued')
                  return `${own} ${id('unweighedAccrued')} ${UNWEIGHED.accrued}`;
                return own;
              }}
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
  rowLabel,
  trace,
  locale,
  strong = false,
  muted = false,
}: {
  figures: NetworkCostProduct | NetworkCostPoint;
  label: ReactNode;
  /** The row in words, for a traced operand's hint. */
  rowLabel: string;
  /** Each cell's `data-trace` ids (`shared/ui/trace`). */
  trace: (field: RowField) => string;
  locale: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const { t } = useTranslation();
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
      <TableCell className={NUM} data-trace={trace('intakeKg')}>
        {dec(f.intake_net_kg)}
      </TableCell>
      <TableCell className={NUM} data-trace={trace('baseKg')}>
        {dash(f.reweigh_net_kg)}
      </TableCell>
      <TableCell className={NUM} data-trace={trace('shortKg')}>
        <ShortfallValue value={weighed ? f.shortfall_kg : null} minus locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${SKY}`} data-trace={trace('accrued')}>
        {dec(f.accrued)}
        {/* No доплати chip on the network day: the figure points at the
            «Нараховано» it is part of. */}
        <TopUpsNote
          value={f.top_ups}
          locale={locale}
          refs={trace('accrued')}
          hint={t('costOfDay.trace.cell', {
            column: t('costOfDay.table.accrued'),
            row: rowLabel,
          })}
        />
      </TableCell>
      <TableCell
        className={`${NUM} ${SKY} ${muted ? '' : 'text-[var(--sky)]'}`}
        data-trace={trace('price')}
      >
        {dec(f.price_was)}
      </TableCell>
      <TableCell className={`${NUM} ${AMBER}`} data-trace={trace('shortfall')}>
        <ShortfallValue value={weighed ? f.shortfall : null} minus locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${AMBER}`} data-trace={trace('shortfallShare')}>
        <ShortfallValue value={f.shortfall_share} locale={locale} />
      </TableCell>
      <TableCell className={`${NUM} ${PLUM}`} data-trace={trace('expensesShare')}>
        {dash(f.expenses_share)}
      </TableCell>
      <TableCell className={`${NUM} ${LEAF}`} data-trace={trace('full')}>
        {dash(f.full_cost)}
      </TableCell>
      <TableCell
        className={`${NUM} ${LEAF} ${strong ? 'text-base font-bold text-[var(--leaf)]' : ''}`}
        data-trace={trace('cost')}
      >
        {dash(f.price_cost)}
      </TableCell>
    </TableRow>
  );
}
