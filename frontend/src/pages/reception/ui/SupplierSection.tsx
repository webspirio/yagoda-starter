import type { Ref } from 'react';
import { ChevronRight, HandCoins } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cn } from '@/shared/lib/cn';
import { cmp, formatKg, formatUah, sub } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { type Supplier } from '@/entities/supplier';
import { useIntakesQuery } from '@/entities/intake';
import { SupplierPicker, type SupplierPickerHandle } from '@/features/pick-supplier';

/** §5.2 — the last three receipts of the chosen supplier, right on the form. */
const HISTORY = 3;

/**
 * «1 · Постачальник» — the picker, and the two things the operator needs to
 * know about the person before weighing anything: what is still owed to them
 * and what they brought last time.
 *
 * Search, pick, and inline creation all live in `SupplierPicker`
 * (`@/features/pick-supplier`); this component is a thin wrapper around it
 * plus the balance strip and the history panel. The parent owns the whole
 * `Supplier` object (not just its id) because the document only carries the
 * id — the picker already had the full row in hand when it was chosen.
 */
export function SupplierSection({
  pointId,
  ownerMode,
  supplier,
  onChange,
  debt,
  disabled,
  pickerRef,
}: {
  pointId: string | null;
  ownerMode: boolean;
  supplier: Supplier | null;
  onChange: (s: Supplier) => void;
  /** `/suppliers/:id/balance` — positive = owed to the supplier, negative = paid ahead. */
  debt: string | null;
  disabled: boolean;
  pickerRef?: Ref<SupplierPickerHandle>;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const history = useIntakesQuery({ supplierId: supplier?.id, limit: HISTORY });

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow>{t('reception.supplier.eyebrow')}</Eyebrow>
      </div>

      <SupplierPicker
        ref={pickerRef}
        pointId={pointId}
        ownerMode={ownerMode}
        value={supplier}
        onChange={onChange}
        disabled={disabled}
      />

      {supplier && debt !== null && cmp(debt, '0') === 1 ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber/10 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <HandCoins className="size-4 shrink-0 text-amber" />
            {t('reception.supplier.debt', { uah: formatUah(debt, locale) })}
          </span>
          <span className="text-xs text-muted-foreground">{t('reception.supplier.debtNote')}</span>
        </div>
      ) : null}
      {supplier && debt !== null && cmp(debt, '0') === -1 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-leaf/10 px-3 py-2 text-sm">
          <HandCoins className="size-4 shrink-0 text-leaf" />
          <span>
            {t('reception.supplier.credit', { uah: formatUah(sub('0', debt), locale) })}
          </span>
        </div>
      ) : null}

      {supplier ? (
        <div className="mt-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>{t('reception.supplier.history')}</Eyebrow>
            <Link
              to={`/suppliers/${supplier.id}`}
              className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('reception.supplier.card')}
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
          {(history.data?.data ?? []).length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('reception.supplier.historyEmpty')}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {(history.data?.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-center gap-2 text-xs',
                    row.voided_at !== null && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {formatShortDate(row.business_date, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {row.voided_at !== null
                      ? t('reception.today.voided')
                      : formatKg(row.net_kg, locale)}
                  </span>
                  <span className="shrink-0 font-mono font-medium">
                    {formatUah(row.amount, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
