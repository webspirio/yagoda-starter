import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { add, cmp, formatDecimal, formatKg, formatUah, sum } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §8.4's three prices — «було» (what it was bought for), «собівартість»
 * (plus its share of the недостача and the витрати) and «нараховане ÷ наша
 * вага» — plus the two звірки, SHOWN TO THE PERSON rather than hidden in a
 * test.
 *
 * «із пулу» is the server's `basket_share`, allocated by largest remainder so
 * the parts sum exactly to the basket. That identity is what the first check
 * below prints, and it is §8.4's own claim: «жодна гривня не загубилася і не
 * з'явилася з нічого». The only arithmetic done here is `add(accrued,
 * basket_share)` for the «разом» column — two server figures summed, never a
 * division.
 *
 * Every derived cell of a product that is not `complete` is «—». It
 * contributed no kilograms to the day's denominator, so it collects no share
 * from it (§3.15), and a row of zeroes beside 128 000,00 нараховано would
 * read as berries that vanished.
 *
 * `day.per_kg` is cast non-null here because `CostOfDayPage` renders this
 * whole section only when it is not: a day with nothing on the scale has no
 * «середня ціна після витрат» to print, and `ExpensesPanel` says that in
 * words instead.
 */
export function FinalPrices({ day, locale }: { day: CostOfDay; locale: string }) {
  const { t } = useTranslation();

  const shares = day.products
    .map((p) => p.basket_share)
    .filter((s): s is string => s !== null);
  const sharesTotal = shares.length > 0 ? sum(shares) : '0.00';
  const sharesMatch = cmp(sharesTotal, day.basket) === 0;

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>{t('costOfDay.final.title')}</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          {/* §8.5's ② and ③ are not built, so this states the rule rather than
              offering a choice: a selector with one legal value is a control
              that looks recorded and is not. */}
          <span className="font-mono text-xs text-muted-foreground">
            {t('costOfDay.final.basis')}
          </span>
          <span className="font-mono text-xs font-medium">
            {t('costOfDay.final.rate', { rate: formatDecimal(day.per_kg as string, locale) })}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('costOfDay.final.product')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.ourWeight')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.fromBasket')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.together')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.cost')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.was')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.byOurWeight')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {day.products.map((p) => (
              <TableRow key={p.product_id}>
                <TableCell className="font-medium">{p.product_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.reweigh_net_kg === null ? '—' : formatKg(p.reweigh_net_kg, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.basket_share === null ? '—' : formatUah(p.basket_share, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.basket_share === null
                    ? '—'
                    : formatUah(add(p.accrued, p.basket_share), locale)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {p.price_cost === null ? '—' : formatDecimal(p.price_cost, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatDecimal(p.price_was, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.price_by_our_weight === null
                    ? '—'
                    : formatDecimal(p.price_by_our_weight, locale)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-border">
              <TableCell className="font-semibold">{t('costOfDay.final.total')}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatKg(day.reweighed_kg, locale)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(sharesTotal, locale)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(add(day.accrued, day.expenses_amount), locale)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-sm leading-relaxed">
        {t('costOfDay.final.summary', {
          basket: formatUah(day.basket, locale),
          kg: formatKg(day.reweighed_kg, locale),
          rate: formatDecimal(day.per_kg as string, locale),
        })}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span
          data-ok={String(sharesMatch)}
          className={cn('font-mono', sharesMatch ? 'text-[var(--leaf)]' : 'text-destructive')}
        >
          {t('costOfDay.final.checkShare', {
            shares: formatUah(sharesTotal, locale),
            basket: formatUah(day.basket, locale),
          })}{' '}
          {sharesMatch ? '✓' : '✗'}
        </span>
        <span className="font-mono text-muted-foreground">
          {t('costOfDay.final.checkTotal', {
            total: formatUah(day.total_check, locale),
            accrued: formatUah(day.accrued, locale),
            expenses: formatUah(day.expenses_amount, locale),
          })}
        </span>
      </div>
    </div>
  );
}
