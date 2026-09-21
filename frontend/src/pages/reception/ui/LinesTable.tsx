import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { cmp, formatDecimal, formatKg } from '@/shared/lib/money';
import { formatBonusSign } from '../lib/formatBonusSign';
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
 * The basket: «Ще позиція» commits the draft, and the committed lines read back
 * as the server priced them (§2.4/§2.8/§2.9). Every figure in the table comes
 * from the preview — the only client-side content is the grade's name.
 */
export function LinesTable({
  rows,
  canAdd,
  atCap,
  disabled,
  lineCount,
  netKg,
  onAdd,
  onRemove,
}: {
  rows: CommittedLine[];
  canAdd: boolean;
  atCap: boolean;
  /** No shift, no document — a committed line cannot be dropped either. */
  disabled: boolean;
  /** `TotalsSection`'s own count — `settled?.items.length ?? lines.fields.length`
   *  from `ReceptionPage` — kept in step with the submit button's own label. */
  lineCount: number;
  /** `null` unless the preview has SETTLED on the form as it stands now — the
   *  counter is withheld rather than built from a stale or half-typed total. */
  netKg: string | null;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  return (
    <div className="border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={!canAdd} onClick={onAdd}>
          <Plus className="size-4" />
          {t('reception.lines.add')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {atCap ? t('reception.lines.capHint') : t('reception.lines.hint')}
        </span>
        {netKg !== null ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {t('reception.lines.counter', { count: lineCount, kg: formatKg(netKg, locale) })}
          </span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <caption className="sr-only">{t('reception.lines.title')}</caption>
            <thead>
              <tr className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                <th scope="col" className="px-2 pb-1 text-left">
                  {t('reception.lines.col.grade')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.gross')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.pallet')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.tare')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.net')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.price')}
                </th>
                <th scope="col" className="px-2 pb-1 text-right">
                  {t('reception.lines.col.amount')}
                </th>
                <th scope="col" className="w-8 pb-1">
                  <span className="sr-only">{t('reception.lines.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => (
                <tr key={row.key} className="font-mono">
                  <td className="px-2 py-1.5 font-sans">{row.gradeLabel}</td>
                  <td className="px-2 py-1.5 text-right">
                    {row.item ? formatDecimal(row.item.gross_kg, locale) : <Pending />}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {row.item ? formatDecimal(row.item.pallet_kg, locale) : <Pending />}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {row.item ? (
                      row.item.tare.reduce((n, tareRow) => n + tareRow.units, 0)
                    ) : (
                      <Pending />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {row.item ? formatDecimal(row.item.net_kg, locale) : <Pending />}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {row.item ? (
                      <>
                        {formatDecimal(row.item.price, locale)}
                        {cmp(row.item.bonus, '0') !== 0 ? (
                          <span className="ml-1 text-amber">
                            {formatBonusSign(row.item.bonus, locale)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <Pending />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {row.item ? formatDecimal(row.item.amount, locale) : <Pending />}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
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
      ) : null}
    </div>
  );
}
