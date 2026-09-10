import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Check } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { useTransfersQuery, type Transfer } from '@/entities/transfer';
import { useAcceptTransferMutation, DisputeTransferDialog } from '@/features/receive-transfer';

/**
 * Перекази «в дорозі» (§7.9 крок 4) — `status: 'sent'`, ще НЕ рахуються в
 * касі (`cashIn` у `buildLedger` дивиться лише на `accepted_date`). Тому
 * число тут НІКОЛИ не збігається з розкладом каси поруч — це стан «в
 * дорозі», а не розбіжність.
 *
 * `canAct` — тільки приймальник точки може натиснути «Прийняв»/«Не
 * сходиться» (§10.3); керівник бачить той самий список, але без кнопок.
 */
export function IncomingTransfers({
  pointId,
  canAct,
}: {
  pointId: string;
  canAct: boolean;
}) {
  const { t, i18n } = useTranslation();
  const transfers = useTransfersQuery({ pointId, status: 'sent' });
  const accept = useAcceptTransferMutation();
  const [disputeTarget, setDisputeTarget] = useState<Transfer | null>(null);

  // A FAILED READ IS NOT «NOTHING IN TRANSIT». Both states used to render
  // the same `null`, so a point whose read failed went on working as if no
  // money were on its way to it — and would neither accept nor dispute a
  // transfer that is already sent (§7.9 step 4). Pending still renders
  // nothing: absence is what a not-yet-answered read honestly looks like.
  if (transfers.isError) {
    return (
      <p role="alert" className="mb-5 text-sm text-destructive">
        {t('pointCash.incoming.loadFailed')}
      </p>
    );
  }

  const pending = transfers.data?.data ?? [];
  if (pending.length === 0) return null;

  const onAccept = async (transfer: Transfer) => {
    try {
      await accept.mutateAsync(transfer.id);
      toast.success(t('transfer.incoming.toastAccepted'));
    } catch (error) {
      toast.error(t(apiErrorToBanner(error, 'transfer.errors.failed')));
    }
  };

  return (
    <div className="mb-5 flex flex-col gap-2">
      {pending.map((transfer) => (
        <div
          key={transfer.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-amber/10 px-4 py-3 ring-1 ring-amber/30"
        >
          <Truck className="size-5 shrink-0 text-amber" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">
              {t('transfer.incoming.inTransit', {
                uah: formatUah(transfer.cash, i18n.resolvedLanguage),
                count: transfer.crates,
              })}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('transfer.incoming.meta', {
                carrier: transfer.carrier,
                date: new Date(transfer.sent_at).toLocaleDateString(i18n.resolvedLanguage),
              })}
            </div>
          </div>
          {canAct ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" onClick={() => onAccept(transfer)} disabled={accept.isPending}>
                <Check className="size-3.5" />
                {t('transfer.incoming.accept')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDisputeTarget(transfer)}>
                {t('transfer.incoming.dispute')}
              </Button>
            </div>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('transfer.incoming.pointAccepts')}
            </span>
          )}
        </div>
      ))}

      {disputeTarget ? (
        <DisputeTransferDialog
          transfer={disputeTarget}
          open
          onClose={() => setDisputeTarget(null)}
        />
      ) : null}
    </div>
  );
}
