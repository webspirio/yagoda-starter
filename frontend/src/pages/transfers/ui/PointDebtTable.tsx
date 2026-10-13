import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, HandCoins, TriangleAlert, ChevronDown } from 'lucide-react';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { PendingSlice } from '@/shared/ui/pending-slice';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { shortfallTone, formatNullableUah, type PointCashRow } from '@/entities/point-cash';
import type { Transfer } from '@/entities/transfer';
import { TransferStatusBadge } from './TransferStatusBadge';
import { DisputeList } from './DisputeDetails';

/**
 * §7.10's table, one row per point: наділ · у касі · не хватає · ящиків ·
 * стан. `GET /point-cash` gives every column except crates.
 *
 * RULE 1 — `target_cash`/`shortfall` are `null` = «не призначали», NEVER
 * `0.00` (§6.9, §7.10): both branch on `== null` explicitly and print «—»,
 * a point never silently reads as fully-funded or debt-free.
 *
 * RULE 2 — the crates cell is a `PendingSlice` (`variant="inline"`), never
 * an em dash: «—» already means «no target» in the column right next to it,
 * and never a bare `0 ящ.`, which would be a claim this backend cannot make
 * (no crate tables exist yet).
 *
 * RULE 3 — «Вирішити» renders whenever a point has an unresolved disputed
 * transfer, full stop. Fix round 1 (finding 4) moved this OFF matching
 * `GET /point-cash`'s thin `latest_transfer: { status, sent_at }` by
 * `sent_at` string equality against the full `Transfer` records — that
 * match was fragile (a cross-endpoint string comparison) AND wrong in a
 * second way: `resolve()` never touches `status` (transfers.service.ts's
 * own doc comment: "THE STATUS IS NOT TOUCHED"), so a dispute the owner
 * already settled stays `status: 'disputed'` forever, and gating on
 * `latest_transfer.status === 'disputed'` alone would keep offering
 * «Вирішити» for it with no way to ever clear the button. Gating directly
 * on the full record's own `resolved_at === null` (done by the page before
 * this component ever sees `unresolvedDisputes`) fixes both at once, and
 * as a side effect no longer requires the dispute to also be the point's
 * literal *latest* transfer — an unresolved dispute stays actionable even
 * if a later, unrelated transfer has since become "latest" for the badge.
 *
 * RULE 4 (#76) — EVERY open dispute stays reachable, not just the first.
 * One open dispute: the badge reads «Не сходиться» and «Вирішити» sits
 * inline, one click as before. Two or more: the badge reads «Не сходиться
 * (N)» and becomes the row's toggle (so does a click on the row itself);
 * the sub-row lists each dispute newest first, each with its own
 * «Вирішити». An open dispute outranks `latest_transfer` for the badge; with
 * none, `latest_transfer.resolved_at` lets a settled dispute read
 * «Врегульовано». `expanded` is DERIVED (`openId === id && count >= 2`), so
 * a refetch that leaves one dispute falls back to the inline layout with no
 * reset effect.
 */
export function PointDebtTable({
  rows,
  unresolvedDisputes,
  onSend,
  onResolve,
}: {
  rows: PointCashRow[];
  /** Disputed, non-voided, NOT YET resolved transfers (`resolved_at ===
   *  null`) — pre-filtered by the page from the SAME `useTransfersQuery`
   *  read it also uses for `TransferHistory`, never a per-row query
   *  (`points.map(useX)` would break rules-of-hooks). */
  unresolvedDisputes: Transfer[];
  onSend: (pointId: string, pointName: string) => void;
  onResolve: (transfer: Transfer) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [openId, setOpenId] = useState<string | null>(null);

  // Open disputes per point, newest `sent_at` first (ISO strings sort
  // chronologically).
  const disputesByPoint = useMemo(() => {
    const map = new Map<string, Transfer[]>();
    for (const tr of unresolvedDisputes) {
      const list = map.get(tr.collection_point_id);
      if (list) list.push(tr);
      else map.set(tr.collection_point_id, [tr]);
    }
    for (const list of map.values()) list.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
    return map;
  }, [unresolvedDisputes]);

  const disputesOf = (row: PointCashRow): Transfer[] =>
    disputesByPoint.get(row.collection_point_id) ?? [];
  const isExpandable = (row: PointCashRow) => disputesOf(row).length >= 2;
  const isExpanded = (row: PointCashRow) =>
    openId === row.collection_point_id && isExpandable(row);
  const toggle = (row: PointCashRow) =>
    setOpenId(isExpanded(row) ? null : row.collection_point_id);

  const columns: Column<PointCashRow>[] = [
    {
      id: 'point',
      header: t('transfers.col.point'),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'target',
      header: t('transfers.col.target'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatNullableUah(row.target_cash, locale),
    },
    {
      id: 'cash',
      header: t('transfers.col.cash'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatUah(row.cash, locale),
    },
    {
      id: 'shortfall',
      header: t('transfers.col.shortfall'),
      align: 'right',
      className: 'font-mono font-semibold tabular-nums',
      // Same tone convention as «Каса точки»'s own shortfall tile (now
      // shared as `shortfallTone`, `entities/point-cash/lib/shortfall.ts`):
      // owed (> 0) reads amber, settled (<= 0) reads leaf — a null stays the
      // default text colour, since «—» is not a value to colour-code.
      cell: (row) => {
        const tone = shortfallTone(row.shortfall);
        const text = formatNullableUah(row.shortfall, locale);
        return tone ? (
          <span className={cn(tone === 'amber' ? 'text-amber' : 'text-leaf')}>{text}</span>
        ) : (
          text
        );
      },
    },
    {
      id: 'crates',
      header: t('transfers.col.crates'),
      align: 'right',
      cell: () => (
        <PendingSlice
          label={t('transfers.crates.label')}
          note={t('transfers.crates.note')}
          variant="inline"
        />
      ),
    },
    {
      id: 'status',
      header: t('transfers.col.status'),
      align: 'right',
      cell: (row) => {
        const disputes = disputesOf(row);
        const expanded = isExpanded(row);
        return (
          <div className="flex items-center justify-end gap-2">
            {disputes.length >= 2 ? (
              <Badge asChild variant="outline" className="cursor-pointer border-destructive/40 text-destructive hover:bg-destructive/10">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(row);
                  }}
                >
                  <TriangleAlert aria-hidden="true" />
                  {t('transfers.disputedCount', { n: disputes.length })}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn('transition-transform', expanded ? undefined : '-rotate-90')}
                  />
                </button>
              </Badge>
            ) : disputes.length === 1 ? (
              <>
                <TransferStatusBadge status="disputed" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve(disputes[0]);
                  }}
                >
                  <HandCoins className="size-3.5" />
                  {t('transfers.resolve')}
                </Button>
              </>
            ) : row.latest_transfer ? (
              <TransferStatusBadge
                status={row.latest_transfer.status}
                resolvedAt={row.latest_transfer.resolved_at}
              />
            ) : null}
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onSend(row.collection_point_id, row.name);
              }}
            >
              <Send className="size-3.5" />
              {t('transfers.send')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable<PointCashRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.collection_point_id}
      onRowClick={toggle}
      rowClickable={isExpandable}
      renderExpanded={(row) =>
        isExpanded(row) ? (
          <DisputeList
            transfers={disputesOf(row)}
            label={t('transfers.dispute.listLabel', { point: row.name })}
            onResolve={onResolve}
          />
        ) : null
      }
      empty={<EmptyState title={t('transfers.empty.title')} />}
    />
  );
}
