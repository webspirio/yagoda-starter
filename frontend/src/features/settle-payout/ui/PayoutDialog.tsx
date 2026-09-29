import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { cmp, formatUah, DECIMAL_INPUT, normalizeAmount, amountRules } from '@/shared/lib/money';
import type { Payout } from '@/entities/payout';
import { useCreatePayoutMutation } from '../api/useCreatePayout';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { PayoutFormValues } from '../model/payoutForm';

/**
 * Payout dialog — records money handed to a supplier as a standalone
 * document (never a field on an intake; spec §5.5). The debt ceiling is
 * mirrored client-side (`cmp(amount, debt)`) purely for UX: the server holds
 * a row lock and re-checks the same ceiling under it, since two payouts
 * racing the same supplier is exactly what the lock exists to prevent.
 *
 * `pointId` is omitted for an operator (their point comes from the token);
 * the owner's caller passes the picked point so `collection_point_id`
 * travels with the request.
 *
 * THERE IS NO RECEIPT-NUMBER FIELD. The operator used to copy one in off the
 * paper payout book; since 2026-09-18 the server numbers the shift itself
 * (`common/document-code.ts`) and the number comes back on the response, to be
 * written onto the paper rather than read off it. The amount stayed: §3.7
 * allows any sum from 0 to «Разом», and only the person at the counter knows
 * which one is leaving the drawer.
 *
 * The parent remounts it via a changing `key` on every open, so the prefilled
 * amount only resets when the whole `PayoutDialog` instance remounts.
 */
export function PayoutDialog({
  supplier,
  pointId,
  debt,
  defaultAmount,
  open,
  onClose,
  onPaid,
}: {
  supplier: { id: string; first_name: string; last_name: string };
  pointId?: string;
  /** The supplier's current balance (Σ intakes − Σ payouts) — the amount
   *  field's ceiling and its default prefill. */
  debt: string;
  /** Pre-fills the amount with something other than the full debt — e.g. a
   *  receipt's «Видати готівкою» passes `min(receiptAmount, debt)`. */
  defaultAmount?: string;
  open: boolean;
  onClose: () => void;
  onPaid?: (payout: Payout) => void;
}) {
  const { t, i18n } = useTranslation();
  const createPayout = useCreatePayoutMutation();
  const locale = i18n.resolvedLanguage;

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<PayoutFormValues>({
    defaultValues: {
      amount: defaultAmount ?? debt,
    },
  });

  const [formError, setFormError] = useState<string | null>(null);
  const name = `${supplier.first_name} ${supplier.last_name}`;

  const watchedAmount = normalizeAmount(useWatch({ control, name: 'amount' }));
  const submitAmount = DECIMAL_INPUT.test(watchedAmount) ? watchedAmount : (defaultAmount ?? debt);

  const setAll = () => {
    setValue('amount', debt);
    clearErrors('amount');
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const amount = normalizeAmount(values.amount);

    if (cmp(amount, '0') !== 1) {
      setError('amount', { message: 'payout.errors.amountZero' });
      return;
    }
    if (cmp(amount, debt) === 1) {
      // `Field` only ever calls `t(key)` with no options, so this ONE error
      // is resolved and interpolated here rather than passed as a bare key —
      // every other message in this dialog is a plain key, resolved by
      // `Field` the way `SetPriceDialog`'s does.
      setError('amount', {
        message: t('payout.errors.exceedsDebt', { debt: formatUah(debt, locale) }),
      });
      return;
    }

    try {
      const payout = await createPayout.mutateAsync({
        supplier_id: supplier.id,
        amount,
        ...(pointId ? { collection_point_id: pointId } : {}),
      });
      toast.success(t('payout.toast.paid', { uah: formatUah(amount, locale) }));
      onPaid?.(payout);
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof PayoutFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payout.form.title', { name })}</DialogTitle>
          <DialogDescription>{t('payout.form.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="amount"
            label={t('payout.form.amount')}
            required
            error={errors.amount?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('amount', amountRules('payout.errors.amountFormat'))}
                autoFocus
              />
            )}
          </Field>

          <Button type="button" variant="outline" disabled={isSubmitting} onClick={setAll}>
            {t('payout.allButton', { uah: formatUah(debt, locale) })}
          </Button>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('payout.submit', { uah: formatUah(submitAmount, locale) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
