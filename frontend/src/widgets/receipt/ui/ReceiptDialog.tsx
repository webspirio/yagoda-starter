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
import { add, cmp, formatKg, formatUah, isZero } from '@/shared/lib/money';
import { formatLongDate, formatTime } from '@/shared/lib/date';
import { canVoidIntake, useIntakeQuery } from '@/entities/intake';
import {
  useSupplierBalanceQuery,
  useSupplierQuery,
  useSupplierSettlementQuery,
  supplierName,
} from '@/entities/supplier';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useMeQuery } from '@/entities/user';
import { useNetworkSettingsQuery } from '@/entities/network-settings';
import { VoidDocumentDialog, reopenedCodes } from '@/features/void-document';
import { ReceiptSheet, type ReceiptSheetLine } from './ReceiptSheet';

/**
 * The receipt for one intake — `GET /intakes/:id` composed with the names a
 * bare id doesn't carry (tare type, supplier, point). The PRODUCT and GRADE
 * names are NOT among them since #148: they ride on the line itself. The
 * grade catalog is active-only, and deactivation is the one removal verb the
 * schema has, so reading the label from it printed «—» on every receipt
 * written before an end-of-season deactivation while the supplier card's
 * timeline still named the berry — one delivery, two accounts of it.
 *
 * Since #116 the payout itself is recorded from the reception screen's own
 * action («Видано готівкою» alongside «Прийняти»), so this dialog no longer
 * opens a `PayoutDialog` — it PRINTS what was paid (the live total plus each
 * linked payout's code, and any voided one as an annulment line) and keeps
 * the one action still local to it: void the document. First widget in the
 * app (spec §"Structure"): the reception, day and supplier-card screens each
 * open the same receipt on the same document, so it lives above `features`
 * and below `pages` rather than inside any one of them.
 *
 * `voidOpen` is local state, so if a caller keeps this dialog mounted (`open`
 * staying `true`) while swapping `intakeId` to a different document, that
 * state would carry over from the previous receipt — remount with
 * `key={intakeId}` when doing that.
 *
 * `startWithVoid` is a table row's «Анулювати»: the receipt opens with its
 * void dialog already on top (once per opening, and only if the viewer may
 * void it); closing the void dialog leaves the receipt itself open.
 */
export function ReceiptDialog({
  intakeId,
  open,
  onClose,
  startWithVoid = false,
}: {
  intakeId: string | null;
  open: boolean;
  onClose: () => void;
  startWithVoid?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const intakeQuery = useIntakeQuery(intakeId);
  const intake = intakeQuery.data;

  const supplierQuery = useSupplierQuery(intake?.supplier_id ?? null);
  const supplier = supplierQuery.data;

  const balanceQuery = useSupplierBalanceQuery(intake?.supplier_id ?? null);
  const balance = balanceQuery.data;

  const tareTypesQuery = useTareTypeOptionsQuery();
  const tareTypes = tareTypesQuery.data;

  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data;

  const meQuery = useMeQuery();
  const me = meQuery.data;

  // Not part of `isError`: a missing note must never stop a supplier's receipt.
  const settingsQuery = useNetworkSettingsQuery();
  const { refetch: refetchSettings } = settingsQuery;
  // The dialog lives as long as its page, so re-read the note on every opening:
  // an owner's save must reach the very next receipt printed.
  useEffect(() => {
    if (open) void refetchSettings();
  }, [open, refetchSettings]);

  const livePayout = intake?.payouts.find((p) => p.voided_at === null) ?? null;

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  // Only fetched once the void dialog is actually open on a receipt with a
  // payout to explain — otherwise every receipt would pay for a settlement
  // read nothing on screen shows.
  const settlementQuery = useSupplierSettlementQuery(
    voidOpen && livePayout ? (intake?.supplier_id ?? null) : null,
  );

  const isError =
    intakeQuery.isError ||
    supplierQuery.isError ||
    balanceQuery.isError ||
    tareTypesQuery.isError ||
    pointsQuery.isError ||
    meQuery.isError;

  // VoidDocumentDialog keeps its form state for its lifetime (react-hook-form's
  // `defaultValues` only apply on mount, and it stays mounted here so `open`
  // alone controls its visibility) — bumping the key on every open forces a
  // fresh instance instead of reopening a stale, half-filled form.
  const openVoid = () => {
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };

  // State adjusted during render, not in an effect: the void dialog is open
  // on the very first frame the receipt is, instead of flashing in a frame
  // later. `autoVoided` makes it once per opening; closing resets it.
  const [autoVoided, setAutoVoided] = useState(false);
  if (!open && autoVoided) setAutoVoided(false);
  if (open && startWithVoid && !autoVoided && intake && me && canVoidIntake(me, intake)) {
    setAutoVoided(true);
    openVoid();
  }

  if (intakeId === null) {
    return null;
  }

  let content: ReactNode = (
    <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  );
  // Extra actions beyond the always-present «Закрити» — only meaningful once
  // the receipt actually resolved.
  let actions: ReactNode = null;
  let dialogs: ReactNode = null;
  let title = t('receipt.title', { code: intake?.code ?? '' });

  if (isError) {
    content = (
      <p role="alert" className="text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  } else if (intake && supplier && balance && tareTypes && points && me) {
    const tareById = new Map(tareTypes.map((tt) => [tt.id, tt]));
    const pointName = points.find((p) => p.id === intake.collection_point_id)?.name ?? '—';
    const receivedBy = intake.received_by_name ?? '—';
    const voided = Boolean(intake.voided_at);

    // §3 quotes «· 1 позиція» — the count rides on every receipt, not only
    // once there is more than one line; `titleLines_one` carries the singular
    // form (M4).
    title = t('receipt.titleLines', { code: intake.code, count: intake.items.length });

    const lines: ReceiptSheetLine[] = intake.items.map((item) => {
      const tareLabel = item.tare
        .map((tareLine) => `${tareLine.units} × ${tareById.get(tareLine.tare_type_id)?.name ?? '—'}`)
        .join(', ');
      return {
        key: item.id,
        // #162: the product alone — the grade shows only through its price.
        // `intake.mapper` keeps `?? ''` for a missing name, hence the «—».
        label: item.product_name || '—',
        gross: formatKg(item.gross_kg, locale),
        pallet: cmp(item.pallet_kg, '0') !== 0 ? formatKg(item.pallet_kg, locale) : null,
        tareLabel,
        tareWeight: formatKg(item.tare_weight_kg, locale),
        net: formatKg(item.net_kg, locale),
        // #164: the final price only — the bonus is folded in, not shown.
        price: formatUah(add(item.price, item.bonus), locale),
        amount: formatUah(item.amount, locale),
      };
    });

    const paid =
      cmp(intake.paid_amount, '0') === 0
        ? null
        : {
            amount: formatUah(intake.paid_amount, locale),
            codes: intake.payouts.filter((p) => p.voided_at === null).map((p) => p.code),
          };
    const voidedPayouts = intake.payouts
      .filter((p) => p.voided_at !== null)
      .map((p) => p.code);

    const crateReturn = intake.crate_return
      ? {
          units: intake.crate_return.units,
          amount: isZero(intake.crate_return.deposit_refund)
            ? null
            : formatUah(intake.crate_return.deposit_refund, locale),
          voided: intake.crate_return.voided_at !== null,
        }
      : null;

    const showVoid = canVoidIntake(me, intake);

    content = (
      <>
        <ReceiptSheet
          code={intake.code}
          // §5 row 50 — the BUSINESS date (from the shift, §2.3), not the
          // calendar day `created_at` happens to carry: a receipt written just
          // past local midnight is still that shift's day, and printing
          // `created_at`'s own date could show one day while `business_date`
          // (and every other document on this receipt's shift) says another.
          date={`${formatLongDate(intake.business_date, locale)} · ${formatTime(intake.created_at, locale)}`}
          pointName={pointName}
          supplierName={supplierName(supplier)}
          lines={lines}
          accrued={formatUah(intake.amount, locale)}
          balance={formatUah(balance.debt, locale)}
          paid={paid}
          voidedPayouts={voidedPayouts}
          receivedBy={receivedBy}
          voided={voided ? { reason: intake.void_reason ?? '' } : null}
          crateReturn={crateReturn}
          note={settingsQuery.data?.receipt_note ?? null}
        />
        {settingsQuery.isError && !settingsQuery.data ? (
          <p className="print-hide text-sm text-muted-foreground">{t('receipt.noteLoadFailed')}</p>
        ) : null}
      </>
    );

    actions = (
      <>
        {showVoid ? (
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
        kind="intake"
        id={intake.id}
        code={intake.code}
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        linkedPayout={
          livePayout
            ? {
                code: livePayout.code,
                amount: livePayout.amount,
                paidAt: livePayout.created_at,
                // Same actor as the receipt (§3.5) — the response carries no payer name.
                paidBy: intake.received_by_name,
                reopens: settlementQuery.data
                  ? reopenedCodes(settlementQuery.data, livePayout.id, intake.id)
                  : null,
                reopensFailed: settlementQuery.isError,
                retryReopens: () => void settlementQuery.refetch(),
              }
            : undefined
        }
        intakeAmount={intake.amount}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[420px] sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('receipt.description')}</DialogDescription>
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
