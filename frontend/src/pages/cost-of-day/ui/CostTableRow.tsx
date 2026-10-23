import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { TableCell, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah } from '@/shared/lib/money';
import type { CostOfDayProduct } from '@/entities/cost-of-day';

/**
 * «Не доїхало» sits in the neutral weight group but is a недостача all the
 * same, so its VALUE turns amber above zero (§4.2) while its column stays
 * untinted — `data-group="shortfall-kg"` marks it for the amber-only test.
 *
 * The column groups' look, shared by the header, the product rows, the grade
 * rows and the total so a group reads as one coloured band top to bottom
 * (spec 2026-10-23 §4.3). One colour per concept: sky is the purchase, amber
 * the недостача and NOTHING else, plum the day's expenses, leaf the result.
 * The weight group stays neutral ink.
 */
export const NUM = 'text-right font-mono tabular-nums';
export const STICKY = 'sticky left-0 z-10 bg-card';
export const SKY = 'bg-[var(--sky)]/8';
export const AMBER = 'bg-[var(--amber)]/8';
export const PLUM = 'bg-[var(--plum)]/8 text-[var(--plum)]';
/** The column every row ends on. Colour is never the only signal: on paper it
 *  is boxed by a 1.5 pt rule on both sides instead. */
export const LEAF =
  'bg-[var(--leaf)]/10 print:border-x-[1.5pt] print:border-solid print:border-foreground';
export const COLUMNS = 10;

/**
 * «у т.ч. доплати …» under a «Нараховано» figure — the part of it no receipt
 * shows (review C3). Nothing at all when the server says '0.00'.
 */
function TopUpsNote({ value, locale }: { value: string; locale: string }) {
  const { t } = useTranslation();
  if (value === '0.00') return null;
  return (
    <div className="text-xs font-normal text-muted-foreground">
      {t('costOfDay.table.topUps', { amount: formatDecimal(value, locale) })}
    </div>
  );
}

/**
 * A недостача figure — `Не доїхало`, `Своя, ₴`, `Дня, ₴/кг`. Above zero it is
 * amber, and the two that are TAKEN from the row (`minus`) wear a «−» so the
 * sign survives a black-and-white print. A weighed zero is a muted «0,00»: a
 * checked nothing, not a blank. `null` is «—», never «0,00» (§8.6 «Це не
 * нуль») — a product nobody put on the scale has no недостача yet.
 *
 * «> 0» is read off the server's string: a weighed zero is exactly '0.00'
 * (the server clamps — §8.2's надлишок is impossible), so no figure is parsed.
 */
export function ShortfallValue({
  value,
  minus = false,
  locale,
}: {
  value: string | null;
  minus?: boolean;
  locale: string;
}) {
  if (value === null) return <>—</>;
  if (value === '0.00') {
    return <span className="text-muted-foreground">{formatDecimal(value, locale)}</span>;
  }
  return (
    <span className="text-[var(--amber)]">
      {minus ? '−' : ''}
      {formatDecimal(value, locale)}
    </span>
  );
}

/**
 * One product, read left to right in §8.4's order:
 * ціна закупки + недостача дня + витрати = собівартість, and every one of
 * those four is a server field printed as it came — the row adds up on screen
 * because the server DEFINES `per_kg` as the sum of its two halves (review
 * C1), not because the browser added anything.
 *
 * A product not reweighed in full keeps its row: what the POINT knows (its
 * weight, нараховано, ціна закупки) is printed, everything the base's scale
 * would have told us is «—», and it collects nothing from the day's недостача
 * or витрати (§3.15) — so its result cells are «—» too.
 *
 * Opened, the row shows its own calculator chain (review C4) — every operand
 * a figure printed in the row or the day's halves — then its grades.
 */
export function CostTableRow({
  product: p,
  shortfallPerKg,
  expensesPerKg,
  open,
  onToggle,
  locale,
}: {
  product: CostOfDayProduct;
  shortfallPerKg: string | null;
  expensesPerKg: string | null;
  open: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const dash = (v: string | null, f: (s: string) => string) => (v === null ? '—' : f(v));
  const dec = (s: string) => formatDecimal(s, locale);

  return (
    <>
      <TableRow>
        <TableCell className={`${STICKY} font-medium`}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(open ? 'costOfDay.berry.hideGrades' : 'costOfDay.berry.showGrades', {
              product: p.product_name,
            })}
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
        </TableCell>
        <TableCell className={NUM}>{dec(p.intake_net_kg)}</TableCell>
        <TableCell className={NUM}>{dash(p.reweigh_net_kg, dec)}</TableCell>
        <TableCell className={NUM} data-group="shortfall-kg">
          <ShortfallValue value={p.complete ? p.shortfall_kg : null} minus locale={locale} />
        </TableCell>
        <TableCell className={`${NUM} ${SKY}`}>
          {formatUah(p.accrued, locale)}
          <TopUpsNote value={p.top_ups} locale={locale} />
        </TableCell>
        <TableCell className={`${NUM} ${SKY} text-[var(--sky)]`}>{dec(p.price_was)}</TableCell>
        <TableCell className={`${NUM} ${AMBER}`} data-group="shortfall">
          <ShortfallValue value={p.complete ? p.shortfall : null} minus locale={locale} />
        </TableCell>
        <TableCell className={`${NUM} ${AMBER}`} data-group="shortfall">
          <ShortfallValue value={p.complete ? shortfallPerKg : null} locale={locale} />
        </TableCell>
        <TableCell className={`${NUM} ${PLUM}`}>
          {p.complete ? dash(expensesPerKg, dec) : '—'}
        </TableCell>
        <TableCell className={`${NUM} ${LEAF} text-base font-bold text-[var(--leaf)]`}>
          {dash(p.price_cost, dec)}
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow className="bg-muted/40 text-muted-foreground hover:bg-muted/40">
          <TableCell colSpan={COLUMNS} className="!pl-9 text-xs whitespace-normal">
            <ul data-chain className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums">
              <li>
                {t('costOfDay.chain.price', {
                  accrued: dec(p.accrued),
                  kg: dec(p.intake_net_kg),
                  price: dec(p.price_was),
                })}
              </li>
              {/* Only a weighed, non-zero недостача has a line: a zero is
                  already the muted 0,00 in the row. */}
              {p.complete && p.shortfall_kg !== '0.00' ? (
                <li data-group="shortfall" className="text-[var(--amber)]">
                  {t('costOfDay.chain.shortfall', {
                    kg: formatKg(p.shortfall_kg, locale),
                    price: dec(p.price_was),
                    amount: formatUah(p.shortfall, locale),
                  })}
                </li>
              ) : null}
              {p.price_cost !== null && shortfallPerKg !== null && expensesPerKg !== null ? (
                <li>
                  {t('costOfDay.chain.cost', {
                    price: dec(p.price_was),
                    shortfall: dec(shortfallPerKg),
                    expenses: dec(expensesPerKg),
                    cost: dec(p.price_cost),
                  })}
                </li>
              ) : null}
            </ul>
          </TableCell>
        </TableRow>
      ) : null}

      {/* The grades are a breakdown, not a second недостача: the shortfall is
          the product's, so their недостача and result cells stay empty. */}
      {open
        ? p.grades.map((g) => (
            <TableRow key={g.product_grade_id} className="bg-muted/40 text-muted-foreground">
              <TableCell className={`${STICKY} !pl-9`}>{g.product_grade_name}</TableCell>
              <TableCell className={NUM}>{dec(g.intake_net_kg)}</TableCell>
              <TableCell className={NUM}>{dash(g.reweigh_net_kg, dec)}</TableCell>
              <TableCell data-group="shortfall-kg" />
              <TableCell className={`${NUM} ${SKY}`}>
                {formatUah(g.accrued, locale)}
                <TopUpsNote value={g.top_ups} locale={locale} />
              </TableCell>
              <TableCell className={`${NUM} ${SKY}`}>{dec(g.price_was)}</TableCell>
              <TableCell className={AMBER} data-group="shortfall" />
              <TableCell className={AMBER} data-group="shortfall" />
              <TableCell className={PLUM} />
              <TableCell className={LEAF} />
            </TableRow>
          ))
        : null}
    </>
  );
}
