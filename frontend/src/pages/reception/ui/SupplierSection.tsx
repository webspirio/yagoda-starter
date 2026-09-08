import { useState } from 'react';
import { ChevronRight, HandCoins } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TextInput } from '@/shared/ui/text-input';
import { cn } from '@/shared/lib/cn';
import { cmp, formatUah, sub } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { useSuppliersQuery, supplierName, type Supplier } from '@/entities/supplier';
import { useIntakesQuery } from '@/entities/intake';

/** The mock browses, it does not paginate: the point's active suppliers, first 30. */
const VISIBLE = 30;
/** §5.2 — the last five receipts of the chosen supplier, right on the form. */
const HISTORY = 5;

/**
 * «1 · Постачальник» — search, pick, and the two things the operator needs to
 * know about the person before weighing anything: what is still owed to them
 * and what they brought last time.
 *
 * The chosen supplier is kept locally rather than re-read by id: the picker
 * already had the whole row in hand, and the parent owns only the id (that is
 * what the document carries). Clearing the form's `supplier_id` — which a
 * saved receipt does — collapses this back to the search box on its own,
 * because `value` is the single source of "is anyone chosen".
 */
export function SupplierSection({
  pointId,
  value,
  onChange,
  debt,
  disabled,
}: {
  pointId: string | null;
  value: string;
  onChange: (id: string) => void;
  /** `/suppliers/:id/balance` — positive = owed to the supplier, negative = paid ahead. */
  debt: string | null;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Supplier | null>(null);
  const [changing, setChanging] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const suppliers = useSuppliersQuery(debouncedSearch, pointId);

  const selected = value !== '' ? chosen : null;
  const browsing = selected === null || changing;

  const rows = (suppliers.data?.data ?? []).filter((s) => s.is_active).slice(0, VISIBLE);
  const history = useIntakesQuery({ supplierId: value || undefined, limit: HISTORY });

  const pick = (s: Supplier) => {
    setChosen(s);
    setChanging(false);
    onChange(s.id);
  };

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow>{t('reception.supplier.eyebrow')}</Eyebrow>
        {selected ? (
          <span className="font-mono text-xs text-muted-foreground">
            {selected.phone ?? t('reception.supplier.noPhone')}
          </span>
        ) : null}
      </div>

      {selected && !changing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <span className="font-medium">{supplierName(selected)}</span>
          <Badge variant="outline">{t(`suppliers.kindLabel.${selected.kind}`)}</Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={disabled}
            onClick={() => setChanging(true)}
          >
            {t('reception.supplier.change')}
          </Button>
        </div>
      ) : null}

      {browsing ? (
        <>
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('reception.supplier.search')}
            aria-label={t('reception.supplier.search')}
            disabled={disabled}
          />
          {rows.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t('reception.supplier.empty')}</p>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {rows.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-current={s.id === value ? 'true' : undefined}
                    onClick={() => pick(s)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
                      s.id === value && 'bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{supplierName(s)}</span>
                    <Badge variant="outline">{t(`suppliers.kindLabel.${s.kind}`)}</Badge>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {s.phone ?? t('reception.supplier.noPhone')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {selected && debt !== null && cmp(debt, '0') === 1 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-sm">
          <HandCoins className="size-4 shrink-0 text-amber" />
          <span>{t('reception.supplier.debt', { uah: formatUah(debt, locale) })}</span>
        </div>
      ) : null}
      {selected && debt !== null && cmp(debt, '0') === -1 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-leaf/10 px-3 py-2 text-sm">
          <HandCoins className="size-4 shrink-0 text-leaf" />
          <span>
            {t('reception.supplier.credit', { uah: formatUah(sub('0', debt), locale) })}
          </span>
        </div>
      ) : null}

      {selected ? (
        <div className="mt-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>{t('reception.supplier.history')}</Eyebrow>
            <Link
              to={`/suppliers/${selected.id}`}
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
                <li key={row.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono">{row.code}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatShortDate(row.business_date, locale)}
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
