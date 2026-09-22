import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Check, TriangleAlert } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { formatShortDate, formatTime } from '@/shared/lib/date';
import { useTransfersQuery, type Transfer } from '@/entities/transfer';
import { useAcceptTransferMutation, DisputeTransferDialog } from '@/features/receive-transfer';

/**
 * Перекази «в дорозі» (§7.9 крок 4) — `status: 'sent'`, ще НЕ рахуються в
 * касі (`cashIn` у `buildLedger` дивиться лише на `accepted_date`). Тому
 * число тут НІКОЛИ не збігається з розкладом каси поруч — це стан «в
 * дорозі», а не розбіжність.
 *
 * Перекази «не сходиться» (R5) — окремий запит, `status: 'disputed'`, і
 * `status` НІКОЛИ не повертається назад (`TransfersService.resolve` сам
 * каже «THE STATUS IS NOT TOUCHED» — те саме читає `TransferStatusBadge`),
 * тому єдина ознака вже владнаного спору — `resolved_at !== null`; такі
 * рядки тут не рендеряться, вони — історія власника. Картка суто
 * інформаційна: на відміну від §9.3, точка нічого тут не виправляє — спір
 * закриває керівник через `POST /transfers/:id/resolve`, а не сторно.
 *
 * `canAct` — тільки приймальник точки може натиснути «Прийняв»/«Не
 * сходиться» на переказі «в дорозі» (§10.3); керівник бачить той самий
 * список, але без кнопок. Червона картка кнопок не має для жодної ролі.
 */
export function IncomingTransfers({ pointId, canAct }: { pointId: string; canAct: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const inTransitQuery = useTransfersQuery({ pointId, status: 'sent' });
  const disputedQuery = useTransfersQuery({ pointId, status: 'disputed' });
  const accept = useAcceptTransferMutation();
  const [disputeTarget, setDisputeTarget] = useState<Transfer | null>(null);

  // A FAILED READ IS NOT «NOTHING IN TRANSIT». Both states used to render
  // the same `null`, so a point whose read failed went on working as if no
  // money were on its way to it — and would neither accept nor dispute a
  // transfer that is already sent (§7.9 step 4). Pending still renders
  // nothing: absence is what a not-yet-answered read honestly looks like.
  if (inTransitQuery.isError || disputedQuery.isError) {
    return (
      <p role="alert" className="mb-5 text-sm text-destructive">
        {t('pointCash.incoming.loadFailed')}
      </p>
    );
  }

  const pending = inTransitQuery.data?.data ?? [];
  // `status` stays `'disputed'` forever once a point disputes a transfer —
  // `resolved_at` is the only signal the owner already closed it (the same
  // check `TransferStatusBadge` makes). A resolved dispute belongs to the
  // owner's `/transfers` history, not this screen.
  const disputed = (disputedQuery.data?.data ?? []).filter((row) => row.resolved_at === null);
  if (pending.length === 0 && disputed.length === 0) return null;

  const onAccept = async (transfer: Transfer) => {
    try {
      await accept.mutateAsync(transfer.id);
      toast.success(t('transfer.incoming.toastAccepted'), {
        description: t('transfer.incoming.toastAcceptedDetail', {
          uah: formatUah(transfer.cash, locale),
          count: transfer.crates,
        }),
      });
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
                uah: formatUah(transfer.cash, locale),
                count: transfer.crates,
              })}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('transfer.incoming.meta', {
                carrier: transfer.carrier,
                // `formatShortDate` wants a `YYYY-MM-DD` business date, not a
                // full timestamp — passing `sent_at` whole would concat its
                // own `T12:00:00Z` onto an already-full ISO string and throw
                // (`Invalid time value`). Slicing to the date is safe here:
                // only the calendar day is shown, never the offset.
                date: formatShortDate(transfer.sent_at.slice(0, 10), locale),
                time: formatTime(transfer.sent_at, locale),
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

      {disputed.map((transfer) => (
        <div
          key={transfer.id}
          className="flex flex-col gap-1.5 rounded-xl bg-destructive/10 px-4 py-3 ring-1 ring-destructive/30"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-destructive">
                {t('transfer.incoming.disputed.header', {
                  date: formatShortDate(transfer.sent_at.slice(0, 10), locale),
                })}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('transfer.incoming.disputed.sent', {
                  uah: formatUah(transfer.cash, locale),
                  count: transfer.crates,
                })}
                {' · '}
                {t('transfer.incoming.disputed.reported', {
                  // Only defensive — every row here came through the dispute
                  // endpoint, which always writes both fields together. The
                  // nullable type is `Transfer`'s (a transfer that was never
                  // disputed has neither), not a real case for a disputed one.
                  uah: formatUah(transfer.reported_cash ?? '0.00', locale),
                  count: transfer.reported_crates ?? 0,
                })}
              </div>
              {transfer.dispute_note ? (
                <div className="mt-1 text-xs text-muted-foreground italic">
                  {t('transfer.incoming.disputed.note', { note: transfer.dispute_note })}
                </div>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('transfer.incoming.disputed.footer')}</p>
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
