import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { add, formatDecimal } from '@/shared/lib/money';
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

  return (
    // 250 px = 18 px header + 8 × (26 px row + 1 px divider) + the 16 px `pb-4`.
    <div className="relative min-h-[250px] flex-1 px-4 pb-4">
      <div className="absolute inset-x-4 top-0 bottom-4 overflow-auto">
        <table className="w-full min-w-[560px] text-xs">
          <caption className="sr-only">{t('reception.lines.title')}</caption>
          <thead>
            <tr className="sticky top-0 z-10 bg-card text-[10px] leading-4 font-medium tracking-[0.12em] whitespace-nowrap text-muted-foreground uppercase">
              <th scope="col" className="px-2 pb-0.5 text-left">
                {t('reception.lines.col.grade')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.gross')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.pallet')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.tare')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.net')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.price')}
              </th>
              <th scope="col" className="px-2 pb-0.5 text-right">
                {t('reception.lines.col.amount')}
              </th>
              <th scope="col" className="w-8 pb-0.5">
                <span className="sr-only">{t('reception.lines.remove')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={row.key} className="h-[26px] font-mono leading-tight">
                <td className="px-2 py-0 font-sans">{row.gradeLabel}</td>
                <td className="px-2 py-0 text-right">
                  {row.item ? formatDecimal(row.item.gross_kg, locale) : <Pending />}
                </td>
                <td className="px-2 py-0 text-right text-muted-foreground">
                  {row.item ? formatDecimal(row.item.pallet_kg, locale) : <Pending />}
                </td>
                <td
                  className="px-2 py-0 text-right text-muted-foreground"
                  title={
                    row.item
                      ? t('reception.lines.tareUnits', {
                          count: row.item.tare.reduce((n, tareRow) => n + tareRow.units, 0),
                        })
                      : undefined
                  }
                >
                  {row.item ? formatDecimal(row.item.tare_weight_kg, locale) : <Pending />}
                </td>
                <td className="px-2 py-0 text-right font-semibold">
                  {row.item ? formatDecimal(row.item.net_kg, locale) : <Pending />}
                </td>
                <td className="px-2 py-0 text-right">
                  {row.item ? (
                    formatDecimal(add(row.item.price, row.item.bonus), locale)
                  ) : (
                    <Pending />
                  )}
                </td>
                <td className="px-2 py-0 text-right font-semibold">
                  {row.item ? formatDecimal(row.item.amount, locale) : <Pending />}
                </td>
                <td className="py-0 text-right">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
