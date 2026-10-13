import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { ReceiptView } from '@/shared/ui/receipt';
import { canVoidPayout, usePayoutQuery } from '@/entities/payout';
import { useSupplierQuery, useSupplierSettlementQuery, supplierName } from '@/entities/supplier';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useMeQuery } from '@/entities/user';
import { useNetworkSettingsQuery } from '@/entities/network-settings';
import { VoidDocumentDialog, reopenedCodes } from '@/features/void-document';
import { buildPayoutReceipt } from '../model/buildPayoutReceipt';

/**
 * The receipt for one standalone payout — `GET /payouts/:id` composed with the
 * names a bare id doesn't carry (supplier, point). Same shell as
 * `ReceiptDialog`: network note re-read on every opening, «Друк» waits for it,
 * «Анулювати» only where §9.4 allows (`canVoidPayout`).
 *
 * `voidOpen` is local state — remount with `key={payoutId}` when swapping the
 * id while `open` stays `true`.
 */
export function PayoutReceiptDialog({
  payoutId,
  open,
  onClose,
}: {
  payoutId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const payoutQuery = usePayoutQuery(payoutId);
  const payout = payoutQuery.data;

  const supplierQuery = useSupplierQuery(payout?.supplier_id ?? null);
  const supplier = supplierQuery.data;

  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data;

  const meQuery = useMeQuery();
  const me = meQuery.data;

  // Not part of `isError`: a missing note must never stop a supplier's receipt.
  const settingsQuery = useNetworkSettingsQuery();
  const { refetch: refetchSettings } = settingsQuery;
  useEffect(() => {
    if (open) void refetchSettings();
  }, [open, refetchSettings]);

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  // Only fetched while the void dialog is open: it names the receipts the void
  // reopens, which nothing else on screen shows.
  const settlementQuery = useSupplierSettlementQuery(voidOpen ? (payout?.supplier_id ?? null) : null);

  const isError =
    payoutQuery.isError || supplierQuery.isError || pointsQuery.isError || meQuery.isError;

  // A fresh VoidDocumentDialog per opening — see ReceiptDialog.
  const openVoid = () => {
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };

  if (payoutId === null) {
    return null;
  }

  let content: ReactNode = <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  let actions: ReactNode = null;
  let dialogs: ReactNode = null;
  // Trimmed: before the payout loads there is no code, and the bare
  // «Квитанція видачі {{code}}» would end in a dangling space.
  let title = t('receipt.payoutTitle', { code: payout?.code ?? '' }).trim();

  if (isError) {
    content = (
      <p role="alert" className="text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  } else if (payout && supplier && points && me) {
    const pointName = points.find((p) => p.id === payout.collection_point_id)?.name ?? '—';
    title = t('receipt.payoutTitle', { code: payout.code });

    content = (
      <>
        <ReceiptView
          doc={buildPayoutReceipt({
            payout,
            supplierName: supplierName(supplier),
            pointName,
            note: settingsQuery.data?.receipt_note ?? null,
            t,
            locale,
          })}
        />
        {settingsQuery.isError && !settingsQuery.data ? (
          <p className="print-hide text-sm text-muted-foreground">{t('receipt.noteLoadFailed')}</p>
        ) : null}
      </>
    );

    actions = (
      <>
        {canVoidPayout(me, payout) ? (
          <Button type="button" variant="destructive" onClick={openVoid}>
            {t('receipt.void')}
          </Button>
        ) : null}
        <Button type="button" disabled={settingsQuery.isFetching} onClick={() => window.print()}>
          {t('receipt.print')}
        </Button>
      </>
    );

    dialogs = (
      <VoidDocumentDialog
        key={voidKey}
        kind="payout"
        id={payout.id}
        code={payout.code}
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        shiftClosed={payout.shift_closed}
        payoutAmount={payout.amount}
        reopens={
          settlementQuery.data ? reopenedCodes(settlementQuery.data, payout.id, null) : null
        }
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[420px] sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('receipt.payoutDescription')}</DialogDescription>
        </DialogHeader>

        {content}

        <DialogFooter className="print-hide">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          {actions}
        </DialogFooter>

        {dialogs}
      </DialogContent>
    </Dialog>
  );
}
