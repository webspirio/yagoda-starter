import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { TextInput } from '@/shared/ui/text-input';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { sum, sub, cmp, isNegative, formatUah } from '@/shared/lib/money';
import { usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useSupplierBalancesQuery, supplierName, type SupplierBalanceRow } from '@/entities/supplier';
import { PayoutDialog } from '@/features/settle-payout';

/**
 * «Залишки за нами» (spec §5.3) — every supplier who currently has an open
 * balance, across the owner's whole network by default (no point picked =
 * no `collection_point_id` param; the API already scopes an owner to
 * everything). An operator is pinned to their own point and gets no picker.
 *
 * The two tiles read straight off the loaded page: «Всього винні» sums only
 * the POSITIVE balances among the loaded rows (a supplier in credit must
 * never shrink the total owed to suppliers who are actually waiting on
 * cash), and «Постачальників із залишком» is the server's own `total` —
 * the honest count even when the page itself was capped at the 100-row
 * `limit`, which is also when the «на цій сторінці» hint appears.
 *
 * The name search is client-side over the loaded rows (spec: no server
 * round trip for a filter over at most 100 rows already in memory).
 */
export function DebtsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const navigate = useNavigate();

  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();
  const balances = useSupplierBalancesQuery({ pointId });

  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<SupplierBalanceRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so PayoutDialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

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

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => supplierName(r).toLowerCase().includes(needle));
  }, [rows, search]);

  const totalOwed = sum(rows.filter((r) => cmp(r.debt, '0') === 1).map((r) => r.debt));
  // No point picked (owner default) is the only time rows can straddle more
  // than one point — a picked point makes the column redundant.
  const showPointColumn = pointId === null;
  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));

  const supplierColumn: Column<SupplierBalanceRow> = {
    id: 'supplier',
    header: t('debts.col.supplier'),
    cell: (row) => (
      <span className="flex items-center gap-2 font-medium">
        {supplierName(row)}
        {!row.is_active ? <Badge variant="secondary">{t('debts.inactive')}</Badge> : null}
      </span>
    ),
  };

  const pointColumn: Column<SupplierBalanceRow> = {
    id: 'point',
    header: t('debts.col.point'),
    hideBelow: 'sm',
    cell: (row) => pointName.get(row.collection_point_id) ?? '—',
  };

  const balanceColumn: Column<SupplierBalanceRow> = {
    id: 'balance',
    header: t('debts.col.balance'),
    align: 'right',
    className: 'font-mono tabular-nums',
    cell: (row) =>
      isNegative(row.debt) ? (
        <span className="text-[var(--leaf)]">
          {t('debts.overpaid', { uah: formatUah(sub('0', row.debt), locale) })}
        </span>
      ) : (
        <span className="text-[var(--amber)]">{formatUah(row.debt, locale)}</span>
      ),
  };

  const actionColumn: Column<SupplierBalanceRow> = {
    id: 'action',
    header: <span className="sr-only">{t('debts.col.action')}</span>,
    align: 'right',
    cell: (row) => (
      <Button
        size="sm"
        disabled={cmp(row.debt, '0') !== 1}
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
    balanceColumn,
    actionColumn,
  ];

  return (
    <>
      <ListPage<SupplierBalanceRow>
        eyebrow={t('debts.eyebrow', { count: total })}
        title={t('debts.title')}
        description={t('debts.description')}
        stats={
          <StatGrid columns={2}>
            <StatTile
              label={t('debts.tiles.totalOwed')}
              value={formatUah(totalOwed, locale)}
              tone="amber"
              hint={total > rows.length ? t('debts.tiles.totalOwedHint') : undefined}
            />
            <StatTile label={t('debts.tiles.withDebt')} value={total} />
          </StatGrid>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canPick ? (
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
        rows={filteredRows}
        rowKey={(row) => row.supplier_id}
        onRowClick={(row) => navigate(`/suppliers/${row.supplier_id}`)}
        isEmpty={!isPending && !isError && filteredRows.length === 0}
        empty={<EmptyState title={t('debts.empty.title')} hint={t('debts.empty.hint')} />}
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
        />
      ) : null}
    </>
  );
}
