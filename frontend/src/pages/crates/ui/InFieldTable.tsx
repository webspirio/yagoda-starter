import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
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
 */
export function InFieldTable({
  rows,
  holders,
  standing,
  truncated,
  renderDocs,
}: {
  rows: CrateBalanceRow[];
  holders: number;
  standing: CrateStanding;
  truncated: boolean;
  renderDocs: (supplierId: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const how = (row: CrateBalanceRow) =>
    row.receipt_units === 0
      ? t('crates.mode.deposit')
      : row.deposit_units === 0
        ? t('crates.mode.receipt')
        : t('crates.mode.split', { deposit: row.deposit_units, receipt: row.receipt_units });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line2 px-4 py-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t('crates.inField.title')}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {t('crates.inField.summary', { units: standing.in_field, count: holders })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('crates.inField.title')}</caption>
          <thead>
            <tr className="border-b border-line2">
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">{t('crates.inField.col.person')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">{t('crates.inField.col.units')}</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">{t('crates.inField.col.how')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">{t('crates.inField.col.deposit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = openId === row.supplier_id;
              const name = `${row.first_name} ${row.last_name}`;
              return (
                <Fragment key={row.supplier_id}>
                  <tr className={cn('border-b border-line2/60', expanded ? 'bg-muted/40' : undefined)}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpenId(expanded ? null : row.supplier_id)}
                        className="flex items-center gap-1.5 text-left hover:text-primary"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded ? undefined : '-rotate-90')}
                        />
                        {name}
                      </button>
                      {row.is_active ? null : (
                        <Badge variant="outline" className="ml-2">{t('crates.inField.inactive')}</Badge>
                      )}
                    </th>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{row.outstanding_units}</td>
                    <td className="px-4 py-2.5 text-left text-muted-foreground">{how(row)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.deposit_units === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatUah(row.deposit_held, i18n.language)
                      )}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-muted/40">
                      <td colSpan={4} className="p-0">{renderDocs(row.supplier_id)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/15 font-medium">
              <th scope="row" className="px-4 py-2.5 text-left">{t('crates.inField.total')}</th>
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{standing.in_field}</td>
              <td className="px-4 py-2.5 text-left text-muted-foreground">
                {t('crates.inField.ofWhichDeposit', { count: standing.deposit_units })}
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                {standing.deposit_units === 0 ? '—' : formatUah(standing.deposit_held, i18n.language)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {truncated ? (
        <p className="border-t border-line2 px-4 py-3 text-xs text-muted-foreground">
          {t('crates.inField.truncated', { shown: rows.length, total: holders })}
        </p>
      ) : null}
    </Card>
  );
}
