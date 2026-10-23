import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { TableCell, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatUah } from '@/shared/lib/money';
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
export const COLUMNS = 11;

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
 * ціна в квитанції + недостача дня + витрати = собівартість, and every one of
 * those four is a server field printed as it came — the row adds up on screen
 * because the server split `per_kg` into its two halves exactly (spec §3.2),
 * not because the browser added anything.
 *
 * A product not reweighed in full keeps its row: what the POINT knows (its
 * weight, нараховано, ₴/кг у квитанції) is printed, everything the base's
 * scale would have told us is «—», and it collects nothing from the day's
 * недостача or витрати (§3.15) — so its result cells are «—» too.
 */
export function CostTableRow({
  product: p,
  perKg,
  shortfallPerKg,
  expensesPerKg,
  open,
  onToggle,
  locale,
}: {
  product: CostOfDayProduct;
  perKg: string | null;
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
        <TableCell className={`${NUM} ${SKY}`}>{formatUah(p.accrued, locale)}</TableCell>
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
        {/* Δ is the day's на кілограм, the same for every product (§8.4
            «однаково на ВСІ товари»), printed only where it became a price. */}
        <TableCell className={`${NUM} text-muted-foreground`}>
          {p.price_cost !== null && perKg !== null ? `+${dec(perKg)}` : '—'}
        </TableCell>
      </TableRow>

      {/* The product's share of the day in hryvnia — the money behind the
          per-kilogram halves. Only a product that collected one has it. */}
      {open && p.basket_share !== null ? (
        <TableRow className="bg-muted/40 text-muted-foreground hover:bg-muted/40">
          <TableCell colSpan={COLUMNS} className="!pl-9 text-xs whitespace-normal">
            {t('costOfDay.table.share', {
              shortfall: dash(p.shortfall_share, dec),
              expenses: dash(p.expenses_share, dec),
              share: formatUah(p.basket_share, locale),
              full: dash(p.full_cost, (v) => formatUah(v, locale)),
              byOur: dash(p.price_by_our_weight, dec),
            })}
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
              <TableCell className={`${NUM} ${SKY}`}>{formatUah(g.accrued, locale)}</TableCell>
              <TableCell className={`${NUM} ${SKY}`}>{dec(g.price_was)}</TableCell>
              <TableCell className={AMBER} data-group="shortfall" />
              <TableCell className={AMBER} data-group="shortfall" />
              <TableCell className={PLUM} />
              <TableCell className={LEAF} />
              <TableCell />
            </TableRow>
          ))
        : null}
    </>
  );
}
