import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { isTruncated } from '@/shared/api';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { TextInput } from '@/shared/ui/text-input';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { decimalKey, useClientSort } from '@/shared/ui/data-table-sort';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { sub, cmp, isNegative, formatUah, formatDecimal, unbreakable } from '@/shared/lib/money';
import { ageInDays, formatShortDate } from '@/shared/lib/date';
import { cn } from '@/shared/lib/cn';
import { usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import {
  useSupplierBalancesQuery,
  supplierName,
  type SupplierBalanceRow,
} from '@/entities/supplier';
import { PayoutDialog } from '@/features/settle-payout';
import { PayoutReceiptDialog, useReceiptOpener } from '@/widgets/receipt';

/**
 * How long a balance has waited, as a three-step scale for the eye (#101, audit D9): up to a
 * week neutral, then amber, and red only past a month — so 45 days no longer reads the same as
 * 8. Thresholds for the eye, not rules — no section of the rules names one.
 */
const AMBER_AFTER_DAYS = 7;
const RED_AFTER_DAYS = 30;

function ageTone(days: number): {
  variant: 'secondary' | 'outline' | 'destructive';
  className?: string;
} {
  if (days > RED_AFTER_DAYS) return { variant: 'destructive' };
  if (days > AMBER_AFTER_DAYS) {
    return {
      variant: 'outline',
      className: 'border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]',
    };
  }
  return { variant: 'secondary' };
}

/**
 * «Залишки за нами» (spec §5.3) — every supplier who currently has an open
 * balance, across the owner's whole network by default (no point picked =
 * no `collection_point_id` param; the API already scopes an owner to
 * everything). An operator is pinned to their own point and gets no picker.
 *
 * THE NETWORK IS THE DEFAULT, NOT THE SKLAD (#229). Every other money screen opens on
 * the point the owner last picked, or the склад (`useWorkingPoint`); this one reads
 * `?point=` alone (`remembered: false`), because §3.9 makes «Усі точки» the owner's
 * view here, and a total quietly narrowed to one point reads as «we owe less».
 *
 * «Всього винні» and «Постачальників із залишком» are the server's own — the sum of the
 * POSITIVE balances (a supplier in credit must never shrink the total owed to suppliers
 * who are actually waiting on cash) and the count of rows owed money (`owed_count`, not the
 * pager's `total`, which also counts a credit — audit D9), both over every visible row, so
 * neither stops at the 100-row `limit` (#229). Until the read lands each tile shows «—»,
 * never a zero (audit D2: a figure not yet known is not «nobody is owed»).
 *
 * «Найстаріший залишок» (#101) is the server's too: the oldest open line among EVERY row owed
 * money, not the loaded page. Each row says how many days its own oldest open line has waited;
 * «open» is read off the stored payout allocations, so a partly paid receipt still counts — the
 * same date the supplier card prints as «найстаріший з 12.07 — 23 дні».
 *
 * The name search is client-side over the loaded rows (spec: no server
 * round trip for a filter over at most 100 rows already in memory), and so is the
 * column sort (#229): it opens on the server's own order, the biggest balance first.
 */
export function DebtsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const navigate = useNavigate();

  const { pointId, canPick, setPointId } = usePointScope({ remembered: false });
  const { data: points } = usePointOptionsQuery();
  const balances = useSupplierBalancesQuery({ pointId });

  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<SupplierBalanceRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so PayoutDialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

  // The slip of the payout just recorded — opened from `onPaid`, never an effect.
  const payoutReceipt = useReceiptOpener();

  const openPayout = (row: SupplierBalanceRow) => {
    setEditing(row);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const isPending = balances.isPending;
  const isError = balances.isError;
  const data = balances.data;
  const rows = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const needle = search.trim();
  const filteredRows = useMemo(() => {
    const lowerNeedle = needle.toLowerCase();
    if (!lowerNeedle) return rows;
    return rows.filter((r) => supplierName(r).toLowerCase().includes(lowerNeedle));
  }, [rows, needle]);
  // A non-empty search that matched nothing is a different story from "every
  // balance is settled" — the rows exist, the search just didn't find them.
  const noMatch = needle !== '' && filteredRows.length === 0;

  const oldestOpen = data?.oldest_open_date ?? null;
  // No point picked (owner default) is the only time rows can straddle more
  // than one point — a picked point makes the column redundant.
  const showPointColumn = pointId === null;
  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));
  const pointOf = (row: SupplierBalanceRow) => pointName.get(row.collection_point_id) ?? null;

  // A credit or a zero row has nothing waiting, whatever the date says.
  const openDays = (row: SupplierBalanceRow) =>
    row.oldest_open_date === null || cmp(row.debt, '0') !== 1
      ? null
      : ageInDays(row.oldest_open_date);

  // What each sortable column orders by — the value, not the rendered cell. No key for a
  // column the table hides, so a sort on it falls back to the biggest balance first.
  const sorted = useClientSort(
    filteredRows,
    {
      supplier: supplierName,
      ...(showPointColumn ? { point: pointOf } : {}),
      age: openDays,
      balance: (row) => decimalKey(row.debt),
    },
    { key: 'balance', order: 'desc' },
  );

  const ageBadge = (row: SupplierBalanceRow, className?: string) => {
    const days = openDays(row);
    if (days === null || row.oldest_open_date === null) return null;
    const since = t('debts.ageSince', { date: formatShortDate(row.oldest_open_date, locale) });
    const tone = ageTone(days);
    return (
      <Badge
        variant={tone.variant}
        className={cn('font-mono tabular-nums', tone.className, className)}
        title={since}
      >
        {t('debts.days', { count: days })}
        {/* `title` alone reaches neither touch nor a screen reader. */}
        <span className="sr-only">, {since}</span>
      </Badge>
    );
  };

  const supplierColumn: Column<SupplierBalanceRow> = {
    id: 'supplier',
    header: t('debts.col.supplier'),
    sortable: true,
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <Link
          to={`/suppliers/${row.supplier_id}`}
          // The row itself navigates to the supplier card too (`onRowClick`
          // below) — without this the link's click would bubble into that
          // handler, firing the same navigation twice.
          onClick={(e) => e.stopPropagation()}
          className="text-brand underline-offset-2 hover:underline"
        >
          {supplierName(row)}
        </Link>
        {!row.is_active ? <Badge variant="secondary">{t('debts.inactive')}</Badge> : null}
        {/* A column of its own from `sm` up (sortable by how long the balance has waited);
            on a phone a fourth column pushed the balance off the screen, so the age rides
            beside the name there. */}
        {ageBadge(row, 'sm:hidden')}
        {/* The point column is hidden on a phone, yet a balance is paid only where it was
            run up (§3.9) — so the point rides under the name there instead (#229). */}
        {showPointColumn ? (
          <span className="basis-full text-xs font-normal text-muted-foreground sm:hidden">
            {pointOf(row) ?? '—'}
          </span>
        ) : null}
      </span>
    ),
  };

  const pointColumn: Column<SupplierBalanceRow> = {
    id: 'point',
    header: t('debts.col.point'),
    hideBelow: 'sm',
    cell: (row) => pointOf(row) ?? '—',
    sortable: true,
  };

  const ageColumn: Column<SupplierBalanceRow> = {
    id: 'age',
    header: t('debts.col.age'),
    hideBelow: 'sm',
    sortable: true,
    cell: (row) => ageBadge(row),
  };

  const balanceColumn: Column<SupplierBalanceRow> = {
    id: 'balance',
    // The unit is in the header, the cells plain (audit rule 4).
    header: t('debts.col.balance'),
    align: 'right',
    className: 'font-mono tabular-nums whitespace-nowrap',
    sortable: true,
    cell: (row) =>
      isNegative(row.debt) ? (
        <span className="text-[var(--leaf)]">
          {/* An inline phrase, not a bare cell figure — so it carries its ₴ (2026-10-24). */}
          {t('debts.overpaid', { amount: unbreakable(formatUah(sub('0', row.debt), locale)) })}
        </span>
      ) : (
        <span className="text-[var(--amber)]">{formatDecimal(row.debt, locale)}</span>
      ),
  };

  const actionColumn: Column<SupplierBalanceRow> = {
    id: 'action',
    header: <span className="sr-only">{t('debts.col.action')}</span>,
    align: 'right',
    cell: (row) => (
      <Button
        size="sm"
        // A column of these is a repeated row action, not the screen's one CTA (audit D8).
        variant="outline"
        // The backend refuses a payout to an inactive supplier (SUPPLIER_INACTIVE),
        // so the row offers none — the supplier card doesn't either (#228).
        disabled={!row.is_active || cmp(row.debt, '0') !== 1}
        onClick={(event) => {
          // The row itself navigates to the supplier card — this button must
          // not trigger that when it opens the payout dialog instead.
          event.stopPropagation();
          openPayout(row);
        }}
      >
        <HandCoins className="size-3.5" />
        {t('debts.payout')}
      </Button>
    ),
  };

  const columns: Column<SupplierBalanceRow>[] = [
    supplierColumn,
    ...(showPointColumn ? [pointColumn] : []),
    ageColumn,
    balanceColumn,
    actionColumn,
  ];

  return (
    <>
      <ListPage<SupplierBalanceRow>
        title={t('debts.title')}
        description={t('debts.description')}
        stats={
          <StatGrid columns={3}>
            <StatTile
              label={t('debts.tiles.totalOwed')}
              value={data ? formatUah(data.total_owed, locale) : '—'}
              tone="amber"
            />
            <StatTile
              label={t('debts.tiles.oldest')}
              value={oldestOpen ? t('debts.days', { count: ageInDays(oldestOpen) }) : '—'}
              hint={
                oldestOpen
                  ? t('debts.tiles.oldestHint', { date: formatShortDate(oldestOpen, locale) })
                  : undefined
              }
            />
            <StatTile
              label={t('debts.tiles.withDebt')}
              value={data ? String(data.owed_count) : '—'}
            />
          </StatGrid>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canPick ? (
              <HeaderSlot slot="scope">
                <SelectField
                  aria-label={t('debts.allPoints')}
                  value={pointId ?? ''}
                  onChange={(e) => setPointId(e.target.value || null)}
                  className="w-48"
                >
                  <option value="">{t('debts.allPoints')}</option>
                  {(points ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
              </HeaderSlot>
            ) : null}
            <TextInput
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('debts.searchPlaceholder')}
              aria-label={t('debts.searchPlaceholder')}
              className="max-w-xs"
            />
          </div>
        }
        columns={columns}
        rows={sorted.rows}
        rowKey={(row) => row.supplier_id}
        onRowClick={(row) => navigate(`/suppliers/${row.supplier_id}`)}
        sort={sorted.sort}
        onSortChange={sorted.onSortChange}
        footer={
          // The server caps a read at 100: past that the sort orders only the loaded rows. A
          // search that found nobody says so in its own empty state.
          isTruncated(data) && !noMatch ? (
            <p className="text-xs text-muted-foreground">
              {t('debts.truncated', { shown: rows.length, total })}
            </p>
          ) : undefined
        }
        isEmpty={!isPending && !isError && filteredRows.length === 0}
        empty={
          noMatch ? (
            <EmptyState
              title={t('debts.empty.noMatchTitle')}
              hint={
                isTruncated(data)
                  ? t('debts.empty.noMatchHint', { count: rows.length })
                  : t('debts.empty.noMatchHintShort')
              }
            />
          ) : (
            <EmptyState title={t('debts.empty.title')} hint={t('debts.empty.hint')} />
          )
        }
      >
        {isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : undefined}
      </ListPage>

      {editing ? (
        <PayoutDialog
          key={dialogInstance}
          supplier={{
            id: editing.supplier_id,
            first_name: editing.first_name,
            last_name: editing.last_name,
          }}
          pointId={editing.collection_point_id}
          debt={editing.debt}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onPaid={(payout) => payoutReceipt.openReceipt(payout.id)}
        />
      ) : null}

      <PayoutReceiptDialog
        key={`payout-${payoutReceipt.receiptId}`}
        payoutId={payoutReceipt.receiptId}
        open={payoutReceipt.open}
        onClose={payoutReceipt.close}
      />
    </>
  );
}
