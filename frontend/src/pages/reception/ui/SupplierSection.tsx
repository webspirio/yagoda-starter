import type { Ref } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatKg, formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { type Supplier } from '@/entities/supplier';
import { useIntakesQuery } from '@/entities/intake';
import { SupplierPicker, type SupplierPickerHandle } from '@/features/pick-supplier';

/** §5.2 — the last three receipts of the chosen supplier, right on the form. */
const HISTORY = 3;

/**
 * The picker and, beside it, what the person brought last time — one row,
 * the history on one truncating line. The balance (debt or credit) is read in
 * «Розрахунок», not here.
 *
 * Search, pick, and inline creation all live in `SupplierPicker`
 * (`@/features/pick-supplier`); this component is a thin wrapper around it
 * plus the history line. The parent owns the whole
 * `Supplier` object (not just its id) because the document only carries the
 * id — the picker already had the full row in hand when it was chosen.
 */
export function SupplierSection({
  pointId,
  ownerMode,
  supplier,
  onChange,
  disabled,
  pickerRef,
  autoFocus,
}: {
  pointId: string | null;
  ownerMode: boolean;
  supplier: Supplier | null;
  onChange: (s: Supplier) => void;
  disabled: boolean;
  pickerRef?: Ref<SupplierPickerHandle>;
  /** Autofocus the picker's trigger — the page passes this only while no
   *  supplier is chosen yet, so returning to this screen (or resetting after
   *  a submit) doesn't steal focus back from whatever the operator is doing. */
  autoFocus?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const history = useIntakesQuery({ supplierId: supplier?.id, limit: HISTORY });

  const rows = history.data?.data ?? [];

  return (
    <div className="flex items-center gap-3 p-4">
      <div className="min-w-0 max-w-[360px] flex-1">
        <SupplierPicker
          ref={pickerRef}
          pointId={pointId}
          ownerMode={ownerMode}
          value={supplier}
          onChange={onChange}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </div>

      {supplier ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {rows.length === 0 ? (
              t('reception.supplier.historyEmpty')
            ) : (
              <>
                <span>{t('reception.supplier.recent')}</span>
                <ul className="inline">
                  {rows.map((row) => (
                    <li
                      key={row.id}
                      className={cn('ml-2 inline', row.voided_at !== null && 'line-through')}
                    >
                      {formatShortDate(row.business_date, locale)} {'·'}{' '}
                      {row.voided_at !== null ? (
                        <span>{t('reception.today.voided')}</span>
                      ) : (
                        <span>{formatKg(row.net_kg, locale)}</span>
                      )}{' '}
                      {'·'} <span className="font-mono">{formatUah(row.amount, locale)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </span>
          <Link
            to={`/suppliers/${supplier.id}`}
            className="flex shrink-0 items-center gap-0.5 transition-colors hover:text-foreground"
          >
            {t('reception.supplier.card')}
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
