import type { ReactNode } from 'react';
import { ChevronRight, IdCard, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { cmp, formatKg, formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { KindBadge, supplierName, useSupplierBalanceQuery, type Supplier } from '@/entities/supplier';
import { useCrateBalanceQuery } from '@/entities/crate';
import { useIntakesQuery } from '@/entities/intake';

/** §5.2 — the last three receipts of the chosen supplier. */
const HISTORY = 3;

/**
 * The button beside the picker and the profile it opens: contacts, crates on
 * hand, the season, the last receipts — and the way to the full card. Every
 * read lives in the content, so nothing is fetched until the operator
 * actually asks to look.
 *
 * No balance tile (R7, spec 2026-10-23): the balance already reads as
 * «Попередній залишок» in «Розрахунок» — one number in one place (compact
 * reception spec, §2 anti-goals) — and it carries the доплати the client
 * wants kept away from the operator.
 */
export function SupplierProfile({ supplier }: { supplier: Supplier | null }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        // Always on the row, so picking a supplier never shifts it; with no
        // supplier there is nothing to show yet (client, 24.10).
        disabled={supplier === null}
        aria-label={t('reception.supplier.profile.open')}
        title={t('reception.supplier.profile.open')}
        className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <IdCard className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        {supplier ? <ProfileBody supplier={supplier} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function ProfileBody({ supplier }: { supplier: Supplier }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const balance = useSupplierBalanceQuery(supplier.id);
  const crates = useCrateBalanceQuery(supplier.id);
  const history = useIntakesQuery({ supplierId: supplier.id, limit: HISTORY });

  const rows = history.data?.data ?? [];
  const deposit = crates.data?.deposit_held;

  return (
    <div>
      <div className="space-y-1 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-base font-semibold">
            {supplierName(supplier)}
          </span>
          <KindBadge kind={supplier.kind} className="shrink-0 text-[10px]" />
        </div>
        {supplier.phone ? (
          <a
            href={`tel:${supplier.phone}`}
            className="flex w-fit items-center gap-1.5 font-mono text-sm text-muted-foreground hover:text-foreground"
          >
            <Phone className="size-3.5" />
            {supplier.phone}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{t('supplierCard.noPhone')}</p>
        )}
        {supplier.note ? (
          <p className="text-sm text-muted-foreground italic">
            {t('supplierCard.note', { note: supplier.note })}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        <Tile
          label={t('reception.supplier.profile.crates')}
          hint={
            deposit !== undefined && cmp(deposit, '0') === 1
              ? t('reception.supplier.profile.deposit', { uah: formatUah(deposit, locale) })
              : undefined
          }
        >
          {crates.data ? crates.data.outstanding_units : '—'}
        </Tile>
        <Tile label={t('supplierCard.tiles.seasonIntakes')}>
          {balance.data ? balance.data.intakes_count : '—'}
        </Tile>
        <Tile label={t('supplierCard.tiles.kgTotal')}>
          {balance.data ? formatKg(balance.data.kg_total, locale) : '—'}
        </Tile>
      </div>

      <div className="px-4 pb-2">
        <Eyebrow className="mb-1">{t('reception.supplier.recent')}</Eyebrow>
        {history.isPending ? null : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('reception.supplier.historyEmpty')}
          </p>
        ) : (
          <ul aria-label={t('reception.supplier.recent')} className="divide-y divide-border">
            {rows.map((row) => {
              const voided = row.voided_at !== null;
              return (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-center gap-3 py-2 text-sm',
                    voided && 'text-muted-foreground',
                  )}
                >
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatShortDate(row.business_date, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-muted-foreground">
                    {voided ? t('reception.today.voided') : formatKg(row.net_kg, locale)}
                  </span>
                  <span className={cn('font-mono tabular-nums', voided && 'line-through')}>
                    {formatUah(row.amount, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        <Button asChild variant="outline" className="w-full justify-between">
          <Link to={`/suppliers/${supplier.id}`}>
            {t('reception.supplier.card')}
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Tile({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
      <Eyebrow className="truncate tracking-wide">{label}</Eyebrow>
      <div
        className="mt-0.5 truncate font-mono text-base font-semibold tabular-nums"
      >
        {children}
      </div>
      {hint ? <div className="truncate text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
