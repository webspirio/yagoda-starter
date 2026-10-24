import { Lock, Pencil, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { formatDecimal } from '@/shared/lib/money';
import { dayPrice } from '../lib/dayPrice';
import type { PriceSheet as Sheet, SheetPoint, SheetRow } from '../model/gradePrice';

/** A price that is not set. A muted dash, never «0» — §4.5 makes the ABSENCE of
 *  a row the disabling mechanism, and zero is a legal price. */
function Missing() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * «Ціна дня загальна» — a bare number when every reception point agrees, a span
 * when they do not, a dash when nobody has priced the grade.
 */
function DayPriceCell({ row, commonIds }: { row: SheetRow; commonIds: readonly string[] }) {
  const { t, i18n } = useTranslation();
  const value = dayPrice(row.prices, commonIds);
  const price = (v: string) => formatDecimal(v, i18n.language);

  if (value === null) return <Missing />;
  if ('common' in value) {
    return <span className="font-mono tabular-nums font-medium">{price(value.common)}</span>;
  }
  // One price, but not on every reception point: say that, rather than «різні · 150,00»,
  // which read as a range of one (audit 2026-10-24, F7).
  if (value.min === value.max) {
    return (
      <span className="whitespace-nowrap text-muted-foreground">
        <span className="font-mono tabular-nums">{price(value.min)}</span>{' '}
        {t('prices.sheet.notEverywhere')}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      <span>{t('prices.sheet.mixed')}</span>
      {': '}
      <span className="font-mono tabular-nums">
        {price(value.min)}–{price(value.max)}
      </span>
    </span>
  );
}

/**
 * #89'S SHEET: rows are grades, columns are points.
 *
 * WHY THE `Table` PRIMITIVES RATHER THAN `DataTable`. `DataTable` takes a fixed
 * `Column[]`; here the columns are DATA — one per point, discovered at runtime —
 * and the first is sticky while the rest scroll. Bending the shared component
 * into that shape would make it worse for its five other callers; the primitives
 * still give the sheet the app's one table look (audit 2026-10-24, F8).
 *
 * THE WAREHOUSE IS A COLUMN, MARKED, AND OUTSIDE THE GESTURE. §4.8: «склад це
 * звичайний пункт прийому зі своєю, вищою ціною, якого жест "поставити всім" НЕ
 * чіпає». It is shown because the owner needs to see that higher price; it is
 * marked because otherwise «встановити всім» would look like it had missed a
 * column; and it is excluded from BOTH the gesture and the «загальна»
 * computation, because including it would make every row read «різні» for the
 * one reason that is never news.
 *
 * THE OPERATOR GETS A LOCK, NOT AN ABSENCE. Mock §5.4 separates the two cases
 * explicitly: a field read-only THROUGH ROLE stays on screen as «значення +
 * іконка замка + підпис», because «приховане поле породжує підозру й дзвінки;
 * заблоковане з підписом вчить правилу». A whole ACTION is the opposite — the
 * «встановити всім» button is ABSENT for an operator, never disabled (§10.2).
 */
export function PriceSheet({
  sheet,
  canEdit,
  onEditCell,
  onSetEverywhere,
  onShowHistory,
}: {
  sheet: Sheet;
  canEdit: boolean;
  onEditCell: (row: SheetRow, point: SheetPoint) => void;
  onSetEverywhere: (row: SheetRow, pointIds: string[]) => void;
  /** §4.2's journal, per (point, grade). Both roles may read it — the operator
   *  reaches it BY clicking a locked cell, which is the only thing their click
   *  can usefully do. */
  onShowHistory: (row: SheetRow, point: SheetPoint) => void;
}) {
  const { t, i18n } = useTranslation();

  // EXACTLY the set the button writes, and exactly the set «загальна» is
  // computed over. One array, used for both, so the column cannot promise an
  // agreement the gesture does not produce.
  const commonIds = sheet.points.filter((p) => p.kind === 'reception').map((p) => p.id);

  return (
    <Card className="overflow-hidden">
      {/* The grid scrolls INSIDE `Table`'s own container; the page body never scrolls
          sideways. */}
      <Table className="min-w-max border-collapse">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="sticky left-0 z-10 bg-card">
              {t('prices.col.grade')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('prices.sheet.common')}
            </TableHead>
            {sheet.points.map((p) => (
              <TableHead scope="col" key={p.id} className="text-right">
                {p.name}
                {p.kind === 'base' ? (
                  <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">
                    {t('prices.sheet.ownPrice')}
                  </span>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sheet.rows.map((row) => (
            <TableRow key={row.product_grade_id}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-6 py-2.5 text-left align-middle font-medium whitespace-nowrap"
              >
                {row.product_name} · {row.grade_name}
              </th>
              <TableCell className="text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <DayPriceCell row={row} commonIds={commonIds} />
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSetEverywhere(row, commonIds)}
                    >
                      <Users className="size-3.5" />
                      {t('prices.sheet.setAll')}
                    </Button>
                  ) : null}
                </span>
              </TableCell>
              {sheet.points.map((p) => {
                const cell = row.prices[p.id];
                return (
                  <TableCell
                    key={p.id}
                    className={cn('text-right', p.kind === 'base' ? 'bg-muted/30' : null)}
                  >
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => onEditCell(row, p)}
                        className="group inline-flex items-center gap-1.5 rounded px-1 font-mono tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={t('prices.sheet.editCell', {
                          grade: `${row.product_name} · ${row.grade_name}`,
                          point: p.name,
                        })}
                      >
                        {cell ? formatDecimal(cell.base_price, i18n.language) : <Missing />}
                        <Pencil
                          className="size-3 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
                          aria-hidden="true"
                        />
                      </button>
                    ) : cell ? (
                      // LOCKED, BUT NOT INERT. The operator cannot change the
                      // price and the lock says so; the click that remains
                      // opens §4.2's journal, which is open to both roles —
                      // «кожна зміна ціни лягає ОКРЕМИМ записом із часом і
                      // автором». Read-only is not the same as opaque.
                      <button
                        type="button"
                        onClick={() => onShowHistory(row, p)}
                        className="inline-flex items-center gap-1.5 rounded px-1 font-mono tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={t('prices.sheet.historyCell', {
                          grade: `${row.product_name} · ${row.grade_name}`,
                          point: p.name,
                        })}
                      >
                        {formatDecimal(cell.base_price, i18n.language)}
                        <Lock
                          className="size-3 text-muted-foreground"
                          role="img"
                          aria-label={t('prices.readOnly')}
                        />
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                        <Missing />
                        <Lock
                          className="size-3 text-muted-foreground"
                          role="img"
                          aria-label={t('prices.readOnly')}
                        />
                      </span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
