import { Trans, useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { TableCell, TableRow } from '@/shared/ui/table';
import {
  formatDecimal,
  formatKg,
  formatUah,
  formatUahPerKg,
  unbreakable,
} from '@/shared/lib/money';
import type { CostOfDayProduct } from '@/entities/cost-of-day';
import { DAY, UNWEIGHED, rowId } from './trace-ids';
import { ShortfallTerm, Term } from './terms';

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
 * shows (review C3). Nothing at all when the server says '0.00'. A phrase, not
 * a cell, so its figure wears its ₴ and is a traced operand: on one point's
 * day it points at the «Доплати» chip above the table (the default `refs`).
 */
export function TopUpsNote({
  value,
  locale,
  refs = DAY.topUps,
  hint,
}: {
  value: string;
  locale: string;
  refs?: string | readonly string[];
  hint?: string;
}) {
  const { t } = useTranslation();
  if (value === '0.00') return null;
  return (
    <div className="text-xs font-normal text-muted-foreground">
      <Trans
        t={t}
        i18nKey="costOfDay.table.topUps"
        values={{ amount: unbreakable(formatUah(value, locale)) }}
        components={{
          amount: <Term refs={refs} hint={hint ?? t('costOfDay.trace.topUps')} />,
        }}
      />
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
  // The chain's operands carry their units — ₴, кг, ₴/кг — and each stays on
  // one line when the chain wraps (2026-10-24: «Завжди показуй одиниці»).
  const uah = (s: string) => unbreakable(formatUah(s, locale));
  const kg = (s: string) => unbreakable(formatKg(s, locale));
  const perKg = (s: string) => unbreakable(formatUahPerKg(s, locale));
  // Every operand of the chain points at the cell of THIS row it was read
  // from (`shared/ui/trace`); the hint names that cell in words.
  const id = (field: Parameters<typeof rowId>[1]) => rowId(p.product_id, field);
  const cell = (column: string) => t('costOfDay.trace.cell', { column, row: p.product_name });
  const col = {
    point: t('costOfDay.table.point'),
    notArrived: t('costOfDay.table.notArrived'),
    accrued: t('costOfDay.table.accrued'),
    price: t('costOfDay.table.priceWas'),
    own: t('costOfDay.table.ownShortfall'),
    day: t('costOfDay.table.dayShortfall'),
    expenses: `${t('costOfDay.table.groupExpenses')} · ${t('costOfDay.table.expensesPerKg')}`,
    cost: t('costOfDay.table.cost'),
  };
  // A product left out of the total is one of the cells the «не перезважено»
  // line under the table sums.
  const unweighed = (own: string, total: string) => (p.complete ? own : `${own} ${total}`);
  // The day's per-kg halves repeat down their column; the «Як читати» line
  // points at the whole column, the row's chain at this row's cell.
  const perDay = (own: string, day: string) => (p.complete ? `${own} ${day}` : own);

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
        <TableCell className={NUM} data-trace={unweighed(id('intakeKg'), UNWEIGHED.intakeKg)}>
          {dec(p.intake_net_kg)}
        </TableCell>
        <TableCell className={NUM} data-trace={id('baseKg')}>
          {dash(p.reweigh_net_kg, dec)}
        </TableCell>
        <TableCell className={NUM} data-group="shortfall-kg" data-trace={id('shortKg')}>
          <ShortfallValue value={p.complete ? p.shortfall_kg : null} minus locale={locale} />
        </TableCell>
        <TableCell
          className={`${NUM} ${SKY}`}
          data-trace={unweighed(id('accrued'), UNWEIGHED.accrued)}
        >
          {dec(p.accrued)}
          <TopUpsNote value={p.top_ups} locale={locale} />
        </TableCell>
        <TableCell className={`${NUM} ${SKY} text-[var(--sky)]`} data-trace={id('price')}>
          {dec(p.price_was)}
        </TableCell>
        <TableCell
          className={`${NUM} ${AMBER}`}
          data-group="shortfall"
          data-trace={id('shortfall')}
        >
          <ShortfallValue value={p.complete ? p.shortfall : null} minus locale={locale} />
        </TableCell>
        <TableCell
          className={`${NUM} ${AMBER}`}
          data-group="shortfall"
          data-trace={perDay(id('shortfallPerKg'), DAY.shortfallPerKg)}
        >
          <ShortfallValue value={p.complete ? shortfallPerKg : null} locale={locale} />
        </TableCell>
        <TableCell
          className={`${NUM} ${PLUM}`}
          data-trace={perDay(id('expensesPerKg'), DAY.expensesPerKg)}
        >
          {p.complete ? dash(expensesPerKg, dec) : '—'}
        </TableCell>
        <TableCell
          className={`${NUM} ${LEAF} text-base font-bold text-[var(--leaf)]`}
          data-trace={id('cost')}
        >
          {dash(p.price_cost, dec)}
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow className="bg-muted/40 text-muted-foreground hover:bg-muted/40">
          <TableCell colSpan={COLUMNS} className="!pl-9 text-xs whitespace-normal">
            <ul data-chain className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums">
              <li>
                <Trans
                  t={t}
                  i18nKey="costOfDay.chain.price"
                  values={{
                    accrued: uah(p.accrued),
                    kg: kg(p.intake_net_kg),
                    price: perKg(p.price_was),
                  }}
                  components={{
                    accrued: <Term refs={id('accrued')} tone="sky" hint={cell(col.accrued)} />,
                    kg: <Term refs={id('intakeKg')} hint={cell(col.point)} />,
                    price: <Term refs={id('price')} tone="sky" hint={cell(col.price)} />,
                  }}
                />
              </li>
              {/* Only a weighed, non-zero недостача has a line: a zero is
                  already the muted 0,00 in the row. */}
              {p.complete && p.shortfall_kg !== '0.00' ? (
                <li data-group="shortfall" className="text-[var(--amber)]">
                  <Trans
                    t={t}
                    i18nKey="costOfDay.chain.shortfall"
                    values={{
                      kg: kg(p.shortfall_kg),
                      price: perKg(p.price_was),
                      amount: uah(p.shortfall),
                    }}
                    components={{
                      kg: <Term refs={id('shortKg')} tone="amber" hint={cell(col.notArrived)} />,
                      price: <Term refs={id('price')} tone="sky" hint={cell(col.price)} />,
                      amount: <Term refs={id('shortfall')} tone="amber" hint={cell(col.own)} />,
                    }}
                  />
                </li>
              ) : null}
              {p.price_cost !== null && shortfallPerKg !== null && expensesPerKg !== null ? (
                <li>
                  <Trans
                    t={t}
                    i18nKey="costOfDay.chain.cost"
                    values={{
                      price: perKg(p.price_was),
                      shortfall: perKg(shortfallPerKg),
                      expenses: perKg(expensesPerKg),
                      cost: perKg(p.price_cost),
                    }}
                    components={{
                      price: <Term refs={id('price')} tone="sky" hint={cell(col.price)} />,
                      shortfall: <ShortfallTerm refs={id('shortfallPerKg')} hint={cell(col.day)} />,
                      expenses: (
                        <Term refs={id('expensesPerKg')} tone="plum" hint={cell(col.expenses)} />
                      ),
                      cost: <Term refs={id('cost')} tone="leaf" hint={cell(col.cost)} />,
                    }}
                  />
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
                {dec(g.accrued)}
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
