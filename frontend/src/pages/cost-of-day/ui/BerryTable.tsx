import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Info } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah, sum } from '@/shared/lib/money';
import type { CostOfDayProduct } from '@/entities/cost-of-day';

/**
 * §8.4's LEFT HALF — «Ліва половина екрана (ЯГОДА) — тільки читання, жодного
 * поля вводу». There is no control in this component by rule, not by
 * omission.
 *
 * Every cell is the server's own figure. «наша вага» — what the base's scale
 * said — is a column beside the point's weight, so the two read side by side.
 * It is `reweigh_net_kg`, `null` — never '0.00' — for a product not weighed in
 * full, printed «—» because §8.6 says so: a zero beside 128 000,00 нараховано
 * reads as berries that disappeared rather than berries nobody has put on the
 * scale yet.
 *
 * The недостача sits in two amber columns, кг with the weights and ₴ with
 * the money. Unweighed is «—» there too; weighed with nothing missing is a
 * checked 0,00, not a blank.
 */
export function BerryTable({
  products,
  reweighedKg,
  accrued,
  shortfallAmount,
  locale,
}: {
  products: CostOfDayProduct[];
  reweighedKg: string;
  accrued: string;
  shortfallAmount: string;
  locale: string;
}) {
  const { t } = useTranslation();
  // Collapsed by default: the row is the product's, the grades are on demand.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (productId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  // Σ of the server's own per-product figures — an addition, never a division.
  const intakeTotal = products.length > 0 ? sum(products.map((p) => p.intake_net_kg)) : '0.00';
  const shortfallKgTotal = products.length > 0 ? sum(products.map((p) => p.shortfall_kg)) : '0.00';
  // Nothing weighed in full: the footer's weighed figures are «—» like every row.
  const anyWeighed = products.some((p) => p.complete);
  const num = 'text-right font-mono tabular-nums';
  const short = 'bg-[var(--amber)]/8 text-[var(--amber)]';

  return (
    <div>
      <Eyebrow className="mb-2">{t('costOfDay.berry.title')}</Eyebrow>
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        {/* Compact on purpose: seven columns beside the expenses panel must fit
            without a horizontal scroll — half the kit's padding, and headers
            that wrap onto a second line rather than widen their column. */}
        <Table className="[&_td]:px-3 [&_th]:h-auto [&_th]:px-3 [&_th]:py-2 [&_th]:leading-tight [&_th]:whitespace-normal">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('costOfDay.berry.product')}</TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.pointWeight')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.ourWeight')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${short}`}>
                <span className="inline-flex items-center gap-1">
                  {t('costOfDay.berry.shortfallKg')}
                  {/* Per product, grades together; a product's surplus is
                      clamped, so the TOTAL is not вага пункту − наша вага (§8.2). */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('costOfDay.berry.shortfallHelpLabel')}
                        className="print-hide hover:text-foreground"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72 text-left">
                      {t('costOfDay.berry.shortfallHelp')}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.perKg')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.accrued')}
              </TableHead>
              <TableHead scope="col" className={`text-right ${short}`}>
                {t('costOfDay.berry.shortfallUah')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const open = expanded.has(p.product_id);
              return (
                <Fragment key={p.product_id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={t(
                          open ? 'costOfDay.berry.hideGrades' : 'costOfDay.berry.showGrades',
                          {
                            product: p.product_name,
                          },
                        )}
                        onClick={() => toggle(p.product_id)}
                        className="print-hide -ml-1 mr-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground align-middle hover:text-foreground"
                      >
                        <ChevronRight
                          className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`}
                        />
                      </button>
                      {p.product_name}
                      {p.complete ? null : (
                        <Badge variant="outline" className="ml-1.5 font-normal">
                          {t('costOfDay.berry.notReweighed')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={num}>{formatKg(p.intake_net_kg, locale)}</TableCell>
                    <TableCell className={num}>
                      {p.reweigh_net_kg === null ? '—' : formatKg(p.reweigh_net_kg, locale)}
                    </TableCell>
                    <TableCell className={`${num} ${short}`}>
                      {p.complete ? formatKg(p.shortfall_kg, locale) : '—'}
                    </TableCell>
                    <TableCell className={num}>{formatDecimal(p.price_was, locale)}</TableCell>
                    <TableCell className={num}>{formatUah(p.accrued, locale)}</TableCell>
                    <TableCell className={`${num} ${short}`}>
                      {p.complete ? formatUah(p.shortfall, locale) : '—'}
                    </TableCell>
                  </TableRow>
                  {/* The grades are a breakdown, not a second недостача: the shortfall
                      is the product's, so their недостача cells stay empty. */}
                  {open
                    ? p.grades.map((g) => (
                        <TableRow
                          key={g.product_grade_id}
                          className="bg-muted/40 text-muted-foreground"
                        >
                          <TableCell className="!pl-9">{g.product_grade_name}</TableCell>
                          <TableCell className={num}>{formatKg(g.intake_net_kg, locale)}</TableCell>
                          <TableCell className={num}>
                            {g.reweigh_net_kg === null ? '—' : formatKg(g.reweigh_net_kg, locale)}
                          </TableCell>
                          <TableCell className={short} />
                          <TableCell className={num}>
                            {formatDecimal(g.price_was, locale)}
                          </TableCell>
                          <TableCell className={num}>{formatUah(g.accrued, locale)}</TableCell>
                          <TableCell className={short} />
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              );
            })}

            <TableRow className="border-t-2 border-border">
              <TableCell className="font-semibold">{t('costOfDay.berry.total')}</TableCell>
              <TableCell className={`${num} font-semibold`}>
                {formatKg(intakeTotal, locale)}
              </TableCell>
              <TableCell className={`${num} font-semibold`}>
                {anyWeighed ? formatKg(reweighedKg, locale) : '—'}
              </TableCell>
              <TableCell className={`${num} ${short} font-semibold`}>
                {anyWeighed ? formatKg(shortfallKgTotal, locale) : '—'}
              </TableCell>
              <TableCell />
              <TableCell className={`${num} font-semibold`}>{formatUah(accrued, locale)}</TableCell>
              <TableCell className={`${num} ${short} font-semibold`}>
                {anyWeighed ? formatUah(shortfallAmount, locale) : '—'}
              </TableCell>
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
