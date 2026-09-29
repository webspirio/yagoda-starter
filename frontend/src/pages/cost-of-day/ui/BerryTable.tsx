import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah, isZero, sum } from '@/shared/lib/money';
import type { CostOfDayProduct } from '@/entities/cost-of-day';

/**
 * §8.4's LEFT HALF — «Ліва половина екрана (ЯГОДА) — тільки читання, жодного
 * поля вводу». There is no control in this component by rule, not by
 * omission.
 *
 * Every cell is the server's own figure. «наша вага» is `reweigh_net_kg`,
 * which is `null` — never '0.00' — for a product not weighed in full, and
 * that null is printed «—» because §8.6 says so in as many words: a zero
 * beside 128 000,00 нараховано reads as berries that disappeared rather than
 * berries nobody has put on the scale yet.
 *
 * The «недостача» line is omitted when there is none, rather than printed as
 * a zero: §8.2 settles that a надлишок is impossible, so this figure is
 * either a claim or nothing at all.
 */
export function BerryTable({
  products,
  reweighedKg,
  accrued,
  locale,
}: {
  products: CostOfDayProduct[];
  reweighedKg: string;
  accrued: string;
  locale: string;
}) {
  const { t } = useTranslation();

  // Σ of the server's own per-product figures — an addition of money already
  // computed, never a division. The response carries no day-level intake
  // weight: `reweighed_kg` is the BASE's total and answers a different
  // question, which is the whole point of the two total rows below.
  const intakeTotal = products.length > 0 ? sum(products.map((p) => p.intake_net_kg)) : '0.00';

  return (
    <div>
      <Eyebrow className="mb-2">{t('costOfDay.berry.title')}</Eyebrow>
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('costOfDay.berry.product')}</TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.weight')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.perKg')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.accrued')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <Fragment key={p.product_id}>
                <TableRow>
                  <TableCell className="font-medium">{p.product_name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatKg(p.intake_net_kg, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatDecimal(p.price_was, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUah(p.accrued, locale)}
                  </TableCell>
                </TableRow>

                {isZero(p.shortfall) ? null : (
                  <TableRow className="text-[var(--amber)]">
                    <TableCell className="pl-6">{t('costOfDay.berry.shortfall')}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatUah(p.shortfall, locale)}
                    </TableCell>
                  </TableRow>
                )}

                <TableRow className="bg-muted/40">
                  <TableCell className="pl-6 font-medium">
                    {t('costOfDay.berry.ourWeight')}
                    {p.complete ? null : (
                      <Badge variant="outline" className="ml-1.5 font-normal">
                        {t('costOfDay.berry.notReweighed')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {p.reweigh_net_kg === null ? '—' : formatKg(p.reweigh_net_kg, locale)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono tabular-nums">
                    {p.price_by_our_weight === null
                      ? '—'
                      : formatDecimal(p.price_by_our_weight, locale)}
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}

            {/* TWO total rows, not one. «РАЗОМ по пункту» is what the POINT
                weighed in; «наша вага, разом» is what the base's scale said.
                Collapsing them prints the base's kilograms under the point's
                own heading. */}
            <TableRow className="border-t-2 border-border">
              <TableCell className="font-semibold">{t('costOfDay.berry.total')}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatKg(intakeTotal, locale)}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(accrued, locale)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('costOfDay.berry.totalOurWeight')}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatKg(reweighedKg, locale)}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t('costOfDay.berry.note')}
      </p>
    </div>
  );
}
