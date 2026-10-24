import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Eyebrow } from '@/shared/ui/eyebrow';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { formatCount, formatDecimal } from '@/shared/lib/money';
import type { CrateBalanceRow, CrateStanding } from '@/entities/crate';

/**
 * «У людей» — who holds this point's crates, and on what terms.
 *
 * THE TOTAL ROW READS THE SERVER. `/crate-balances` is paginated, so summing
 * `rows` would undercount the moment a point has more holders than one page;
 * `standing` (from `GET /crate-standing`) counts everyone.
 *
 * «—» IN THE DEPOSIT COLUMN MEANS NO CASH COVER AT ALL — a person holding only
 * розписка crates. A zero would read as «the deposit came back».
 *
 * On the shared `Table` primitives (audit 2026-10-24, F8) — one table look across the
 * app; the unit lives in the header («Завдаток, ₴»), the cells are plain figures.
 */
const NUM = 'text-right font-mono tabular-nums';

export function InFieldTable({
  rows,
  total,
  standing,
  truncated,
  renderDocs,
}: {
  rows: CrateBalanceRow[];
  total: number;
  standing: CrateStanding;
  truncated: boolean;
  renderDocs: (supplierId: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [openId, setOpenId] = useState<string | null>(null);

  const how = (row: CrateBalanceRow) =>
    row.outstanding_units === 0
      ? '—'
      : row.receipt_units === 0
        ? t('crates.mode.deposit')
        : row.deposit_units === 0
          ? t('crates.mode.receipt')
          : t('crates.mode.split', {
              deposit: formatCount(row.deposit_units, lang),
              receipt: formatCount(row.receipt_units, lang),
            });

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line2 px-6 py-3">
        <Eyebrow>
          <h2>{t('crates.inField.title')}</h2>
        </Eyebrow>
        <span className="font-mono text-xs text-muted-foreground">
          {t('crates.inField.summary', {
            units: formatCount(standing.in_field, lang),
            count: standing.holders,
          })}
        </span>
      </div>
      <Table>
        <caption className="sr-only">{t('crates.inField.title')}</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">{t('crates.inField.col.person')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('crates.inField.col.units')}
            </TableHead>
            <TableHead scope="col">{t('crates.inField.col.how')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('crates.inField.col.deposit')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = openId === row.supplier_id;
            const name = `${row.first_name} ${row.last_name}`;
            return (
              <Fragment key={row.supplier_id}>
                <TableRow className={expanded ? 'bg-muted/40' : undefined}>
                  <th
                    scope="row"
                    className="px-6 py-2.5 text-left align-middle font-medium whitespace-nowrap"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenId(expanded ? null : row.supplier_id)}
                      className="inline-flex items-center gap-1.5 rounded text-left outline-none hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'size-4 shrink-0 text-muted-foreground transition-transform',
                          expanded ? undefined : '-rotate-90',
                        )}
                      />
                      {name}
                    </button>
                    {row.is_active ? null : (
                      <Badge variant="outline" className="ml-2">
                        {t('crates.inField.inactive')}
                      </Badge>
                    )}
                  </th>
                  <TableCell className={NUM}>{formatCount(row.outstanding_units, lang)}</TableCell>
                  <TableCell className="text-muted-foreground">{how(row)}</TableCell>
                  <TableCell className={NUM}>
                    {row.deposit_units === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatDecimal(row.deposit_held, lang)
                    )}
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="p-0 whitespace-normal">
                      {renderDocs(row.supplier_id)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter className="border-t-2 border-foreground/15 bg-transparent">
          <TableRow className="hover:bg-transparent">
            <th scope="row" className="px-6 py-2.5 text-left align-middle">
              {t('crates.inField.total')}
            </th>
            <TableCell className={cn(NUM, 'font-semibold')}>
              {formatCount(standing.in_field, lang)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {t('crates.inField.ofWhichDeposit', { count: standing.deposit_units })}
            </TableCell>
            <TableCell className={cn(NUM, 'font-semibold')}>
              {standing.deposit_units === 0 ? '—' : formatDecimal(standing.deposit_held, lang)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {truncated ? (
        <p className="border-t border-line2 px-6 py-3 text-xs text-muted-foreground">
          {t('crates.inField.truncated', { shown: rows.length, total })}
        </p>
      ) : null}
    </Card>
  );
}
