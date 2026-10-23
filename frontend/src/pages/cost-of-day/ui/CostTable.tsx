import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';
import {
  AMBER,
  COLUMNS,
  CostTableRow,
  LEAF,
  NUM,
  PLUM,
  SKY,
  STICKY,
  ShortfallValue,
} from './CostTableRow';

/**
 * §8.4 on one table (spec 2026-10-23 §4.2): one row per product, read left to
 * right in calculation order — weight → purchase → недостача → витрати →
 * собівартість — so «ціна в квитанції + недостача дня + витрати = собівартість»
 * can be checked by eye on every row.
 *
 * There is no control here but the grade toggles, by rule: the only input on
 * the screen is the expenses strip (§8.4: one place of entry). And there is no
 * arithmetic: every figure, the total row included, is the server's own — the
 * «−» and «+» are text in front of a formatted server value, never a result.
 *
 * The total row «Пункт» covers the products weighed in full only (spec §3.4),
 * so each of its columns adds up within itself. A product not reweighed in full
 * is reported on its own muted line under it, never folded in. Its Δ cell is
 * EMPTY on purpose: the point's ₴/кг is per point-kilogram and the average
 * собівартість per base-kilogram, so 185,54 + 3,22 ≠ 188,74 and a Δ there would
 * be the one figure on the table that does not add up.
 */
export function CostTable({ day, locale }: { day: CostOfDay; locale: string }) {
  const { t } = useTranslation();
  // Collapsed by default: the row is the product's, the share and the grades
  // are on demand.
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
  const anyUnweighed = day.products.some((p) => !p.complete);

  const group = (label: string, span: number, tone: string, extra: Record<string, string> = {}) => (
    <TableHead
      scope="colgroup"
      colSpan={span}
      className={`border-b-2 text-center text-xs uppercase tracking-wide ${tone}`}
      {...extra}
    >
      {label}
    </TableHead>
  );

  return (
    <div>
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        {/* `Table` scrolls inside its own container below its natural width —
            the page never does; the product column stays put while it scrolls. */}
        <Table className="[&_td]:px-3 [&_th]:h-auto [&_th]:px-3 [&_th]:py-2 [&_th]:leading-tight [&_th]:whitespace-normal">
          <TableHeader>
            {/* Group names stay in the header on paper too: colour is never the
                only signal of which band a figure belongs to (§4.3). */}
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
                { 'data-group': 'shortfall' },
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
              <TableHead scope="col" className="text-right" data-group="shortfall-kg">
                {t('costOfDay.table.notArrived')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${SKY}`}>
                <span className="inline-flex items-center gap-1">
                  {t('costOfDay.table.accrued')}
                  <Help label={t('costOfDay.table.accruedHelpLabel')}>
                    {t('costOfDay.table.accruedHelp')}
                  </Help>
                </span>
              </TableHead>
              <TableHead scope="col" className={`text-right ${SKY}`}>
                {t('costOfDay.table.priceWas')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${AMBER}`} data-group="shortfall">
                {t('costOfDay.table.ownShortfall')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${AMBER}`} data-group="shortfall">
                {t('costOfDay.table.dayShortfall')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${PLUM}`}>
                {t('costOfDay.table.expensesPerKg')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${LEAF}`}>
                {t('costOfDay.table.cost')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.table.delta')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {day.products.map((p) => (
              <CostTableRow
                key={p.product_id}
                product={p}
                perKg={day.per_kg}
                shortfallPerKg={day.shortfall_per_kg}
                expensesPerKg={day.expenses_per_kg}
                open={expanded.has(p.product_id)}
                onToggle={() => toggle(p.product_id)}
                locale={locale}
              />
            ))}

            {/* `weighed` is `null` until something is on the scale: then the
                whole row is «—», never a zero (§8.6). */}
            <TableRow className="border-t-2 border-border font-semibold">
              <TableCell className={STICKY}>{t('costOfDay.table.total')}</TableCell>
              <TableCell className={NUM}>{dash(w?.intake_kg)}</TableCell>
              <TableCell className={NUM}>{w === null ? '—' : dec(day.reweighed_kg)}</TableCell>
              <TableCell className={NUM} data-group="shortfall-kg">
                <ShortfallValue value={w?.shortfall_kg ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${SKY}`}>
                {dash(w?.accrued, (v) => formatUah(v, locale))}
              </TableCell>
              <TableCell className={`${NUM} ${SKY} text-[var(--sky)]`}>
                {dash(w?.price_was)}
              </TableCell>
              <TableCell className={`${NUM} ${AMBER}`} data-group="shortfall">
                <ShortfallValue value={w?.shortfall ?? null} minus locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${AMBER}`} data-group="shortfall">
                <ShortfallValue value={day.shortfall_per_kg} locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${PLUM}`}>{dash(day.expenses_per_kg)}</TableCell>
              <TableCell className={`${NUM} ${LEAF} text-base font-bold text-[var(--leaf)]`}>
                <span className="inline-flex items-center gap-1">
                  {dash(day.price_cost_avg)}
                  <Help label={t('costOfDay.table.avgHelpLabel')}>
                    {t('costOfDay.table.avgHelp')}
                  </Help>
                </span>
              </TableCell>
              <TableCell />
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

      {day.per_kg !== null ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <Trans
            t={t}
            i18nKey="costOfDay.table.howToRead"
            values={{ kg: formatKg(day.reweighed_kg, locale) }}
            components={{
              sky: <span className="font-medium text-[var(--sky)]" />,
              amber: <span className="font-medium text-[var(--amber)]" />,
              plum: <span className="font-medium text-[var(--plum)]" />,
              leaf: <span className="font-medium text-[var(--leaf)]" />,
            }}
          />
        </p>
      ) : (
        // Nothing weighed yet: the expenses have landed nowhere. Muted, not
        // amber — amber is the недостача's, and there is none yet (§4.3).
        <div data-awaiting className="mt-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t('costOfDay.expenses.awaiting')}</p>
          <p>
            {t('costOfDay.expenses.awaitingAmount', {
              amount: formatUah(day.expenses_amount, locale),
            })}
          </p>
          <p className="text-xs">{t('costOfDay.expenses.awaitingNote')}</p>
        </div>
      )}

      {/* ⓘ vanishes on paper with `print-hide`, so its texts print here. */}
      <ol className="print-only mt-2 list-decimal pl-5 text-xs">
        <li>
          <span className="font-medium">{t('costOfDay.table.accruedHelpLabel')}</span>{' '}
          {t('costOfDay.table.accruedHelp')}
        </li>
        <li>
          <span className="font-medium">{t('costOfDay.table.avgHelpLabel')}</span>{' '}
          {t('costOfDay.table.avgHelp')}
        </li>
      </ol>
    </div>
  );
}

/** An ⓘ beside a header or a figure; the same text prints as a footnote. */
function Help({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="print-hide text-muted-foreground hover:text-foreground"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-left font-normal">{children}</TooltipContent>
    </Tooltip>
  );
}
