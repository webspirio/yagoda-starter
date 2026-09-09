import { useState, type ReactNode } from 'react';
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
import { cmp, formatKg, formatUah } from '@/shared/lib/money';
import { formatLongDate } from '@/shared/lib/date';
import { useIntakeQuery } from '@/entities/intake';
import { useSupplierBalanceQuery, useSupplierQuery, supplierName } from '@/entities/supplier';
import { useGradeCatalogQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useMeQuery } from '@/entities/user';
import { PayoutDialog } from '@/features/settle-payout';
import { VoidDocumentDialog } from '@/features/void-document';
import { ReceiptSheet, type ReceiptSheetLine } from './ReceiptSheet';

/** Formats a bonus for the «Ціна за кг» row: `null` when it is 0.00 (the row
 *  then shows the bare price), a leading `+` for a markup — `formatUah`
 *  already carries the typographic minus for a discount, so a negative bonus
 *  needs nothing added. */
function formatBonus(bonus: string, locale: string): string | null {
  const sign = cmp(bonus, '0');
  if (sign === 0) return null;
  const formatted = formatUah(bonus, locale);
  return sign === 1 ? `+${formatted}` : formatted;
}

/**
 * The receipt for one intake — `GET /intakes/:id` composed with the names a
 * bare id doesn't carry (grade, product, tare type, supplier, point) and the
 * two actions the mock's Ф2 flow opens from here: settle the supplier's
 * balance in cash, or void the document. First widget in the app (spec
 * §"Structure"): the reception, day and supplier-card screens each open the
 * same receipt on the same document, so it lives above `features` and below
 * `pages` rather than inside any one of them.
 *
 * `payoutOpen`/`voidOpen` are local state, so if a caller keeps this dialog
 * mounted (`open` staying `true`) while swapping `intakeId` to a different
 * document, that state would carry over from the previous receipt — remount
 * with `key={intakeId}` when doing that.
 */
export function ReceiptDialog({
  intakeId,
  open,
  onClose,
}: {
  intakeId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const intakeQuery = useIntakeQuery(intakeId);
  const intake = intakeQuery.data;

  const supplierQuery = useSupplierQuery(intake?.supplier_id ?? null);
  const supplier = supplierQuery.data;

  const balanceQuery = useSupplierBalanceQuery(intake?.supplier_id ?? null);
  const balance = balanceQuery.data;

  const gradeCatalog = useGradeCatalogQuery();
  const tareTypesQuery = useTareTypeOptionsQuery();
  const tareTypes = tareTypesQuery.data;

  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data;

  const meQuery = useMeQuery();
  const me = meQuery.data;

  const isError =
    intakeQuery.isError ||
    supplierQuery.isError ||
    balanceQuery.isError ||
    gradeCatalog.isError ||
    tareTypesQuery.isError ||
    pointsQuery.isError ||
    meQuery.isError;

  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutKey, setPayoutKey] = useState(0);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  // PayoutDialog/VoidDocumentDialog keep their form state for their lifetime
  // (react-hook-form's `defaultValues` only apply on mount, and both stay
  // mounted here so `open` alone controls their visibility) — bumping the key
  // on every open forces a fresh instance instead of reopening a stale,
  // half-filled form.
  const openPayout = () => {
    setPayoutKey((k) => k + 1);
    setPayoutOpen(true);
  };
  const openVoid = () => {
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };

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

  if (isError) {
    content = (
      <p role="alert" className="text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  } else if (intake && supplier && balance && !gradeCatalog.isPending && tareTypes && points && me) {
    const gradeById = new Map(gradeCatalog.data.map((g) => [g.id, g]));
    const tareById = new Map(tareTypes.map((tt) => [tt.id, tt]));
    const pointName = points.find((p) => p.id === intake.collection_point_id)?.name ?? '—';
    const receivedBy = me.id === intake.received_by_user_id ? me.display_name : '—';
    const voided = Boolean(intake.voided_at);

    const lines: ReceiptSheetLine[] = intake.items.map((item) => {
      const grade = gradeById.get(item.product_grade_id);
      const tareLabel = item.tare
        .map((tareLine) => `${tareLine.units} × ${tareById.get(tareLine.tare_type_id)?.name ?? '—'}`)
        .join(', ');
      return {
        key: item.id,
        label: grade ? `${grade.productName} · ${grade.name}` : '—',
        gross: formatKg(item.gross_kg, locale),
        pallet: cmp(item.pallet_kg, '0') !== 0 ? formatKg(item.pallet_kg, locale) : null,
        tareLabel,
        tareWeight: formatKg(item.tare_weight_kg, locale),
        net: formatKg(item.net_kg, locale),
        price: formatUah(item.price, locale),
        bonus: formatBonus(item.bonus, locale),
        amount: formatUah(item.amount, locale),
      };
    });

    const defaultPayoutAmount =
      cmp(intake.amount, balance.debt) === 1 ? balance.debt : intake.amount;
    const showPayout = !voided && cmp(balance.debt, '0') === 1;
    const showVoid =
      !voided && (me.role === 'network_owner' || me.id === intake.received_by_user_id);

    content = (
      <ReceiptSheet
        code={intake.code}
        date={formatLongDate(intake.business_date, locale)}
        pointName={pointName}
        supplierName={supplierName(supplier)}
        lines={lines}
        accrued={formatUah(intake.amount, locale)}
        balance={formatUah(balance.debt, locale)}
        receivedBy={receivedBy}
        voided={voided ? { reason: intake.void_reason ?? '' } : null}
      />
    );

    actions = (
      <>
        {showVoid ? (
          <Button type="button" variant="destructive" onClick={openVoid}>
            {t('receipt.void')}
          </Button>
        ) : null}
        {showPayout ? (
          <Button type="button" variant="outline" onClick={openPayout}>
            {t('receipt.payOut')}
          </Button>
        ) : null}
        <Button type="button" onClick={() => window.print()}>
          {t('receipt.print')}
        </Button>
      </>
    );

    dialogs = (
      <>
        <PayoutDialog
          key={payoutKey}
          supplier={{
            id: supplier.id,
            first_name: supplier.first_name,
            last_name: supplier.last_name,
          }}
          // Always known here (the intake's own point) — unlike a debts-list
          // caller, this dialog never needs to fall back to the operator's
          // token-derived point.
          pointId={intake.collection_point_id}
          debt={balance.debt}
          defaultAmount={defaultPayoutAmount}
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
        />

        <VoidDocumentDialog
          key={voidKey}
          kind="intake"
          id={intake.id}
          code={intake.code}
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
        />
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('receipt.title', { code: intake?.code ?? '' })}</DialogTitle>
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
