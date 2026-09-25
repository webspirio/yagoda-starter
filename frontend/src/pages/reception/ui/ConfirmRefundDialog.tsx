import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { formatUah, isZero } from '@/shared/lib/money';
import { useReturnPreviewQuery } from '@/features/return-crates';

/**
 * «Видайте людині дві суми» — the stop before a receipt that refunds a crate
 * deposit (2026-09-25). The refund beside «З них наших ящиків» was easy to
 * miss, and that field PRE-FILLS, so a return could be written without the
 * operator ever typing in it. This dialog names every sum the person is owed
 * and the drawer each comes out of, and the confirm button carries the
 * deposit itself.
 *
 * Mounted only while a submit is waiting on it. Mounting refreshes the
 * server's FIFO split (`staleTime: 0` on `useReturnPreviewQuery`), and the
 * confirm stays disabled until that fresh answer is in: the operator confirms
 * a figure the server has just stated, never one from before the last
 * keystroke. A failed preview never falls through to «accept anyway» — the
 * dialog exists to name a sum, and without one it has nothing to confirm.
 *
 * A return taken wholly on a розписка refunds nothing, so there is nothing
 * to miss: when the fresh preview says `0.00` the dialog never opens and
 * `onConfirm` fires straight away.
 *
 * Focus lands on «Назад» (Radix AlertDialog's default): Enter is how the
 * operator submits the form, and a second habitual Enter must not accept.
 */
export function ConfirmRefundDialog({
  supplierId,
  pointId,
  units,
  paid,
  onConfirm,
  onCancel,
}: {
  supplierId: string;
  /** The owner's picked point; omitted for an operator (their token has it). */
  pointId?: string;
  units: number;
  /** The berry payout handed over with this receipt, or `null` for none. */
  paid: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const preview = useReturnPreviewQuery({ supplierId, units, pointId });

  const fresh = !preview.isFetching && !preview.isError ? (preview.data ?? null) : null;
  const noMoney = fresh !== null && isZero(fresh.deposit_refund);

  // Fires once: a StrictMode double effect must not submit the receipt twice.
  const submitted = useRef(false);
  const confirmOnce = () => {
    if (submitted.current) return;
    submitted.current = true;
    onConfirm();
  };
  const confirmFromEffect = useEffectEvent(confirmOnce);
  useEffect(() => {
    if (noMoney) confirmFromEffect();
  }, [noMoney]);

  if (noMoney) return null;

  const depositUnits = (fresh?.allocations ?? [])
    .filter((a) => a.mode === 'deposit')
    .reduce((n, a) => n + a.units, 0);
  const receiptUnits = (fresh?.allocations ?? [])
    .filter((a) => a.mode === 'receipt')
    .reduce((n, a) => n + a.units, 0);

  return (
    // Radix closes on «Action» too — a close that follows a confirm is not a
    // cancel, and must not tell the page to drop the submit it just started.
    <AlertDialog open onOpenChange={(next) => !next && !submitted.current && onCancel()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {paid !== null ? t('reception.refundConfirm.titleTwo') : t('reception.refundConfirm.titleOne')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-left">
              {preview.isError ? (
                <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
                  <span>{t('reception.refundConfirm.failed')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void preview.refetch()}
                  >
                    {t('reception.refundConfirm.retry')}
                  </Button>
                </div>
              ) : fresh === null ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  {t('reception.refundConfirm.loading')}
                </span>
              ) : (
                <ul className="flex flex-col gap-2 text-foreground">
                  {paid !== null ? (
                    <li>
                      {t('reception.refundConfirm.berries')} —{' '}
                      <strong className="font-mono">{formatUah(paid, locale)}</strong>{' '}
                      {t('reception.refundConfirm.berryDrawer')}
                    </li>
                  ) : null}
                  <li>
                    {t('reception.refundConfirm.deposit', { count: depositUnits })} —{' '}
                    <strong className="font-mono">{formatUah(fresh.deposit_refund, locale)}</strong>{' '}
                    {t('reception.refundConfirm.crateDrawer')}
                  </li>
                  {receiptUnits > 0 ? (
                    <li className="text-muted-foreground">
                      {t('reception.refundConfirm.receiptPart', { count: receiptUnits })}
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="cta">{t('reception.refundConfirm.back')}</AlertDialogCancel>
          <AlertDialogAction size="cta" disabled={fresh === null} onClick={() => confirmOnce()}>
            {fresh !== null
              ? t('reception.refundConfirm.confirm', {
                  amount: formatUah(fresh.deposit_refund, locale),
                })
              : t('reception.refundConfirm.pending')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
