import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, HandCoins, ChevronDown } from 'lucide-react';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { cn } from '@/shared/lib/cn';
import { cmp, sub, formatDecimal, formatUah } from '@/shared/lib/money';
import { shortfallTone, type PointCashRow } from '@/entities/point-cash';
import type { Transfer } from '@/entities/transfer';
import { TransferStatusBadge } from './TransferStatusBadge';
import { DisputeList } from './DisputeDetails';

/**
 * §7.10's table, one row per point: наділ · у касі · не вистачає · стан.
 * `GET /point-cash` gives every column. (The «Ящиків · поки не рахуються»
 * placeholder column is gone — audit 2026-10-24, C10.) Money cells are plain
 * figures; the unit is in the header (rule 4).
 *
 * RULE 1 — `target_cash`/`shortfall` are `null` = «не призначали», NEVER
 * `0.00` (§6.9, §7.10): both branch on `== null` explicitly and print «—»,
 * a point never silently reads as fully-funded or debt-free.
 *
 * RULE 2 — a label agrees with its sign (C5): a NEGATIVE shortfall prints
 * «понад 2 800,00», never «−2 800,00» under «Не вистачає».
 *
 * RULE 3 — «Вирішити» renders whenever a point has an unresolved disputed
 * transfer, full stop, gated on the full records' own `resolved_at === null`
 * (done by the page before this component ever sees `unresolvedDisputes`)
 * and matched by point id, never by `sent_at` against `latest_transfer`
 * (fix round 1, finding 4: that cross-endpoint string match was fragile).
 * `resolve()` never touches `status` (transfers.service.ts: "THE STATUS IS
 * NOT TOUCHED"), so a settled dispute stays `status: 'disputed'` forever;
 * `latest_transfer.resolved_at` (#76) is what lets that row's badge read
 * «Врегульовано» instead. An open dispute need not be the point's latest
 * transfer: when a newer one exists, its own badge («У дорозі» /
 * «Прийнято») stays visible BESIDE the dispute badge, never replaced by it.
 *
 * RULE 4 (#76) — EVERY open dispute stays reachable, not just the first.
 * One open dispute: the badge reads «Не сходиться» and «Вирішити» sits
 * inline, one click as before. Two or more: the badge reads «Не сходиться
 * (N)» and becomes the row's toggle (so does a click on the row itself);
 * the sub-row lists each dispute newest first, each with its own
 * «Вирішити». With no open dispute the badge is `latest_transfer`'s alone.
 * `expanded` is DERIVED (`openId === id && count >= 2`), so a refetch that
 * leaves one dispute falls back to the inline layout at once; `openId` is
 * then cleared during render, so a later second dispute arrives collapsed.
 */
export function PointDebtTable({
  rows,
  unresolvedDisputes,
  inTransit = new Map(),
  onSend,
  onResolve,
}: {
  rows: PointCashRow[];
  /** Disputed, non-voided, NOT YET resolved transfers (`resolved_at ===
   *  null`) — pre-filtered by the page from the SAME `useTransfersQuery`
   *  read it also uses for `TransferHistory`, never a per-row query
   *  (`points.map(useX)` would break rules-of-hooks). */
  unresolvedDisputes: Transfer[];
  /** C4 — Σ `cash` of the point's `sent` transfers, by point id (already summed with `sum`). */
  inTransit?: Map<string, string>;
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

  // A point that drops below two disputes forgets it was open, so gaining a
  // second one later does not re-open the list by itself. Adjusting state
  // during render (React's documented pattern), not a reset effect.
  if (openId !== null && (disputesByPoint.get(openId)?.length ?? 0) < 2) setOpenId(null);

  const disputesOf = (row: PointCashRow): Transfer[] =>
    disputesByPoint.get(row.collection_point_id) ?? [];
  const isExpandable = (row: PointCashRow) => disputesOf(row).length >= 2;
  const isExpanded = (row: PointCashRow) => openId === row.collection_point_id && isExpandable(row);
  const toggle = (row: PointCashRow) => setOpenId(isExpanded(row) ? null : row.collection_point_id);

  const plain = (v: string | null) => (v == null ? '—' : formatDecimal(v, locale));

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
      className: 'font-mono tabular-nums whitespace-nowrap',
      cell: (row) => plain(row.target_cash),
    },
    {
      id: 'cash',
      header: t('transfers.col.cash'),
      align: 'right',
      className: 'font-mono tabular-nums whitespace-nowrap',
      cell: (row) => plain(row.cash),
    },
    {
      id: 'shortfall',
      header: t('transfers.col.shortfall'),
      align: 'right',
      className: 'font-mono font-semibold tabular-nums whitespace-nowrap',
      // Same tone convention as «Каса точки»'s own shortfall tile (now
      // shared as `shortfallTone`, `entities/point-cash/lib/shortfall.ts`):
      // owed (> 0) reads amber, settled (<= 0) reads leaf — a null stays the
      // default text colour, since «—» is not a value to colour-code.
      cell: (row) => {
        const tone = shortfallTone(row.shortfall);
        const over = row.shortfall != null && cmp(row.shortfall, '0') === -1;
        // Owed (> 0): the rows the page tile «Винні точкам» sums — the `data-trace`
        // sources its terms light (`debt:owed`, `debt:road`).
        const owed = row.shortfall != null && cmp(row.shortfall, '0') === 1;
        // «понад 500,00 ₴» is a phrase, not a bare cell figure: it carries its unit.
        const text =
          row.shortfall == null
            ? '—'
            : over
              ? t('transfers.overTarget', { amount: formatUah(sub('0', row.shortfall), locale) })
              : formatDecimal(row.shortfall, locale);
        const road = inTransit.get(row.collection_point_id);
        return (
          <div className="flex flex-col items-end">
            {tone ? (
              <span
                data-trace={owed ? 'debt:owed' : undefined}
                className={cn(tone === 'amber' ? 'text-amber' : 'text-leaf')}
              >
                {text}
              </span>
            ) : (
              text
            )}
            {road ? (
              <span
                data-trace={owed ? 'debt:road' : undefined}
                className="text-xs font-normal text-muted-foreground"
              >
                {t('transfers.onTheRoad', { uah: formatUah(road, locale) })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: t('transfers.col.status'),
      align: 'right',
      cell: (row) => {
        const disputes = disputesOf(row);
        const expanded = isExpanded(row);
        // RULE 3: an open dispute does not hide a NEWER transfer — its own
        // «У дорозі»/«Прийнято» stays beside the dispute badge. Only when the
        // latest transfer IS a dispute would that repeat «Не сходиться».
        const latest = row.latest_transfer;
        const latestBadge = latest ? (
          <TransferStatusBadge status={latest.status} resolvedAt={latest.resolved_at} />
        ) : null;
        return (
          <div className="flex items-center justify-end gap-2">
            {/* Badges STACK rather than sit side by side: a point with an open
                dispute AND a newer transfer in transit carries two, and in one
                line they pushed the table past its card at 1440 px (#76). */}
            <div className="flex flex-col items-end gap-1">
              {/* The latest transfer's own badge stays beside the dispute badge —
                  unless it IS an open dispute, which the badge below already
                  names. A settled one reads «Врегульовано», so it stays. */}
              {disputes.length > 0 && !(latest?.status === 'disputed' && latest.resolved_at == null)
                ? latestBadge
                : null}
              {disputes.length >= 2 ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="group cursor-pointer rounded-4xl outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(row);
                  }}
                >
                  <TransferStatusBadge
                    status="disputed"
                    count={disputes.length}
                    className="group-hover:bg-destructive/10"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('transition-transform', expanded ? undefined : '-rotate-90')}
                    />
                  </TransferStatusBadge>
                </button>
              ) : disputes.length === 1 ? (
                <TransferStatusBadge status="disputed" />
              ) : (
                latestBadge
              )}
            </div>
            {disputes.length === 1 ? (
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
            ) : null}
            {/* A row-level repeated action — outline, never a column of
                berry buttons (rule 1). */}
            <Button
              size="sm"
              variant="outline"
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
