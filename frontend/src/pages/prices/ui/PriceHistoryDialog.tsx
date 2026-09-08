import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { formatDecimal } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import type { GradeCatalogItem } from '@/entities/product-grade';
import { usePriceHistoryQuery } from '../api/gradePrices';
import type { GradePrice } from '../model/gradePrice';

/** The mock's dash for a missing value — mirrors `PricesPage`'s own `Missing`. */
function Missing() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * Read-only journal of every price a grade has ever had at one point — the
 * per-row «Історія» a priced grade offers both roles, since a price is never
 * edited (§ price history is append-only, same discipline as a document).
 *
 * Rows come back NEWEST FIRST from the API and are rendered as returned — no
 * client-side re-sort — so this dialog trusts the same ordering contract the
 * journal itself promises.
 */
export function PriceHistoryDialog({
  pointId,
  grade,
  open,
  onClose,
}: {
  pointId: string;
  grade: GradeCatalogItem;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const history = usePriceHistoryQuery(pointId, grade.id);
  const rows = history.data ?? [];
  const gradeLabel = `${grade.productName} · ${grade.name}`;

  const columns: Column<GradePrice>[] = [
    {
      id: 'date',
      header: t('prices.history.col.date'),
      className: 'font-mono text-xs whitespace-nowrap',
      cell: (row) => (
        <>
          {formatShortDate(row.created_at.slice(0, 10), i18n.language)}{' '}
          {/* Local wall clock, not the UTC slice of created_at — same
              convention DayPage's feed uses for a document's timestamp. */}
          {new Date(row.created_at).toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </>
      ),
    },
    {
      id: 'base',
      header: t('prices.history.col.base'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatDecimal(row.base_price, i18n.language),
    },
    {
      id: 'markup',
      header: t('prices.history.col.markup'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (row) => formatDecimal(row.max_markup, i18n.language),
    },
    {
      id: 'discount',
      header: t('prices.history.col.discount'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (row) => formatDecimal(row.max_discount, i18n.language),
    },
    {
      id: 'reason',
      header: t('prices.history.col.reason'),
      cell: (row) => row.reason ?? <Missing />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('prices.history.title', { grade: gradeLabel })}</DialogTitle>
        </DialogHeader>

        {history.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : history.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('prices.history.empty')}
          </p>
        ) : (
          <DataTable<GradePrice> columns={columns} rows={rows} rowKey={(row) => row.id} frame={false} />
        )}
      </DialogContent>
    </Dialog>
  );
}
