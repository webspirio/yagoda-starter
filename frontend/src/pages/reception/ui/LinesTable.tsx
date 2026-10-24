import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { add, formatDecimal, isZero } from '@/shared/lib/money';
import type { IntakePreviewItem } from '../model/intakeForm';

export interface CommittedLine {
  /** RHF field-array key — stable across a re-order, unlike the index. */
  key: string;
  gradeLabel: string;
  /** The server's row for this line, or null while no preview covers it yet. */
  item: IntakePreviewItem | null;
}

/** A number the server has not sent yet — never a client-side stand-in. */
function Pending() {
  return <span className="text-muted-foreground">…</span>;
}

/**
 * The basket: the lines «Ще позиція» (the draft block's footer) has committed,
 * read back as the server priced them (§2.4/§2.8/§2.9). Every figure in the
 * table comes from the preview — the only client-side content is the grade's
 * name. A row re-checks on a calculator (R5, spec 2026-10-23): Брутто −
 * Піддон − Тара (in kg, the units in its `title`) = Нетто, × Ціна (the final
 * price, the bonus folded in as on the draft line and the receipt, #164) =
 * Сума. It sits AFTER the draft block, so its ✕ buttons are never Tab stops
 * between the picker and Брутто (spec §5.2).
 *
 * The table always holds room for eight rows (client, 24.10), committed or not, so
 * the card does not jump as lines are added; it grows to fill the card when
 * the settlement card beside it is taller, and scrolls inside under a sticky
 * header once the lines outgrow it.
 */
export function LinesTable({
  rows,
  disabled,
  onRemove,
}: {
  rows: CommittedLine[];
  /** No shift, no document — a committed line cannot be dropped either. */
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  // A pallet comes off one line in a hundred — while no committed line has
  // one, its column is only noise (B10). A pending row may still have one.
  const showPallet = rows.some((row) => row.item === null || !isZero(row.item.pallet_kg));
  // The kit's table look (`shared/ui/table`) at the card's density: the unit
  // lives in the header, the cells are plain figures (audit 2026-10-24, rule 4).
  const head = 'h-auto px-2 pb-1 text-right';
  const cell = 'px-2 py-0 text-right';

  return (
    // 250 px = 18 px header + 8 × (26 px row + 1 px divider) + the 16 px `pb-4`
    // — held open from `lg`, where the two cards stand side by side. On a
    // phone the page scrolls anyway, so the table is only as tall as its rows.
    <div className="relative flex-1 px-4 pb-4 lg:min-h-[250px]">
      <div className="overflow-auto lg:absolute lg:inset-x-4 lg:top-0 lg:bottom-4">
        {/* A bare `<table>`, not `Table`: its own overflow wrapper would become
            the scroll container and unstick the header below. */}
        <table className="w-full min-w-[520px] text-xs">
          <caption className="sr-only">{t('reception.lines.title')}</caption>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className={cn(head, 'text-left')}>
                {t('reception.lines.col.grade')}
              </TableHead>
              <TableHead scope="col" className={head}>
                {t('reception.lines.col.gross')}
              </TableHead>
              {showPallet ? (
                <TableHead scope="col" className={head}>
                  {t('reception.lines.col.pallet')}
                </TableHead>
              ) : null}
              <TableHead scope="col" className={head}>
                {t('reception.lines.col.tare')}
              </TableHead>
              <TableHead scope="col" className={head}>
                {t('reception.lines.col.net')}
              </TableHead>
              <TableHead scope="col" className={head}>
                {t('reception.lines.col.price')}
              </TableHead>
              <TableHead scope="col" className={head}>
                {t('reception.lines.col.amount')}
              </TableHead>
              <TableHead scope="col" className="h-auto w-8 px-0 pb-1">
                <span className="sr-only">{t('reception.lines.remove')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.key} className="h-[26px] font-mono leading-tight tabular-nums">
                <TableCell className="px-2 py-0 font-sans whitespace-normal">
                  {row.gradeLabel}
                </TableCell>
                <TableCell className={cell}>
                  {row.item ? formatDecimal(row.item.gross_kg, locale) : <Pending />}
                </TableCell>
                {showPallet ? (
                  <TableCell className={cn(cell, 'text-muted-foreground')}>
                    {row.item ? formatDecimal(row.item.pallet_kg, locale) : <Pending />}
                  </TableCell>
                ) : null}
                <TableCell
                  className={cn(cell, 'text-muted-foreground')}
                  title={
                    row.item
                      ? t('reception.lines.tareUnits', {
                          count: row.item.tare.reduce((n, tareRow) => n + tareRow.units, 0),
                        })
                      : undefined
                  }
                >
                  {row.item ? formatDecimal(row.item.tare_weight_kg, locale) : <Pending />}
                </TableCell>
                <TableCell className={cn(cell, 'font-semibold')}>
                  {row.item ? formatDecimal(row.item.net_kg, locale) : <Pending />}
                </TableCell>
                <TableCell className={cell}>
                  {row.item ? (
                    formatDecimal(add(row.item.price, row.item.bonus), locale)
                  ) : (
                    <Pending />
                  )}
                </TableCell>
                <TableCell className={cn(cell, 'font-semibold')}>
                  {row.item ? formatDecimal(row.item.amount, locale) : <Pending />}
                </TableCell>
                <TableCell className="px-0 py-0 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('reception.lines.remove')}
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
