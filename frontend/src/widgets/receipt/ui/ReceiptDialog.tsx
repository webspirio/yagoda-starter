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
import { add, cmp, formatKg, formatUah, isNegative } from '@/shared/lib/money';
import { formatDateTime } from '@/shared/lib/date';
import { useIntakeQuery } from '@/entities/intake';
import { useSupplierBalanceQuery, useSupplierQuery, supplierName } from '@/entities/supplier';
import { useGradeCatalogQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useMeQuery } from '@/entities/user';
import { VoidDocumentDialog } from '@/features/void-document';
import { ReceiptSheet, type ReceiptSheetLine } from './ReceiptSheet';

/** Formats the «Ціна за кг» row's right side when a per-kilogram bonus/markup
 *  applies: `+ 5.00 ₴ = 140.00 ₴` for a markup, `− 5.00 ₴ = 130.00 ₴` for a
 *  discount. The operator itself carries the sign, so only the MAGNITUDE of
 *  the bonus is formatted (never a second `−` from `formatUah`) — `null`
 *  when the bonus is 0.00, so the row falls back to the bare price. */
function formatBonus(price: string, bonus: string, locale: string): string | null {
  if (cmp(bonus, '0') === 0) return null;
  const magnitude = isNegative(bonus) ? bonus.slice(1) : bonus;
  const operator = isNegative(bonus) ? '−' : '+';
  return `${operator} ${formatUah(magnitude, locale)} = ${formatUah(add(price, bonus), locale)}`;
}

/**
 * The receipt for one intake — `GET /intakes/:id` composed with the names a
 * bare id doesn't carry (grade, product, tare type, supplier, point). Since
 * #116 the payout itself is recorded from the reception screen's own action
 * («Видано готівкою» alongside «Прийняти»), so this dialog no longer opens a
 * `PayoutDialog` — it PRINTS what was paid (the live total plus each linked
 * payout's code, and any voided one as an annulment line) and keeps the one
 * action still local to it: void the document. First widget in the app (spec
 * §"Structure"): the reception, day and supplier-card screens each open the
 * same receipt on the same document, so it lives above `features` and below
 * `pages` rather than inside any one of them.
 *
 * `voidOpen` is local state, so if a caller keeps this dialog mounted (`open`
 * staying `true`) while swapping `intakeId` to a different document, that
 * state would carry over from the previous receipt — remount with
 * `key={intakeId}` when doing that.
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

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  // VoidDocumentDialog keeps its form state for its lifetime (react-hook-form's
  // `defaultValues` only apply on mount, and it stays mounted here so `open`
  // alone controls its visibility) — bumping the key on every open forces a
  // fresh instance instead of reopening a stale, half-filled form.
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
  let title = t('receipt.title', { code: intake?.code ?? '' });

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
    const receivedBy = intake.received_by_name ?? '—';
    const voided = Boolean(intake.voided_at);

    // §3 quotes «· 1 позиція» — the count rides on every receipt, not only
    // once there is more than one line; `titleLines_one` carries the singular
    // form (M4).
    title = t('receipt.titleLines', { code: intake.code, count: intake.items.length });

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
        bonus: formatBonus(item.price, item.bonus, locale),
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

    const showVoid =
      !voided && (me.role === 'network_owner' || me.id === intake.received_by_user_id);

    content = (
      <ReceiptSheet
        code={intake.code}
        date={formatDateTime(intake.created_at, locale)}
        pointName={pointName}
        supplierName={supplierName(supplier)}
        lines={lines}
        accrued={formatUah(intake.amount, locale)}
        balance={formatUah(balance.debt, locale)}
        paid={paid}
        voidedPayouts={voidedPayouts}
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
        <Button type="button" onClick={() => window.print()}>
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
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[420px]" showCloseButton={false}>
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
