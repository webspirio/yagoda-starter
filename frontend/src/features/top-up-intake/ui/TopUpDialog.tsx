import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { amountRules, normalizeAmount } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useCreateTopUpMutation } from '../api/useCreateTopUp';

interface TopUpFormValues {
  amount: string;
  reason: string;
}

/**
 * «ФАНТОМНИЙ ЗАЛИШОК» (#61) — the owner adds a fixed amount of supplier debt
 * against a receipt that is already recorded, because a price was renegotiated
 * after the berries were handed over.
 *
 * THERE IS NO DOWNWARD PATH HERE, and that is not an oversight. `amount` is
 * positive only: a negative row would reduce a debt with no cash leaving the
 * drawer, which §3.2 forbids «для ЖОДНОЇ ролі». Correcting a price DOWNWARD
 * stays §9.3 — void the receipt and reissue it at the right price.
 *
 * THE REASON IS THE FEATURE. #61 asks for it in as many words: «щоб при
 * перегляді історії було ясно зрозуміло, чому ми маємо викладати дві тисячі
 * цьому постачальнику». It is required, and required NON-BLANK — a reason of
 * three spaces passes a length check and leaves whitespace standing as the
 * explanation for a two-thousand-hryvnia debt, which is why the server tests
 * `\S` and so does this form.
 *
 * The parent remounts it via a changing `key` on every open, so there is no
 * reset effect.
 */
export function TopUpDialog({
  intake,
  supplierName,
  open,
  onClose,
}: {
  /** The receipt this money is for. Its code is what the owner recognises — a
   *  top-up has no code of its own and never will. */
  intake: { id: string; code: string };
  supplierName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createTopUp = useCreateTopUpMutation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TopUpFormValues>({ defaultValues: { amount: '', reason: '' } });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createTopUp.mutateAsync({
        intake_id: intake.id,
        amount: normalizeAmount(values.amount),
        reason: values.reason.trim(),
      });
      toast.success(t('topUp.toast.created'));
      onClose();
    } catch (error) {
      setFormError(
        apiErrorToBanner(error, 'topUp.errors.failed', {
          // Shared code, screen-specific consequence — see `apiErrorToBanner`.
          SUPPLIER_INACTIVE: 'topUp.errors.supplierInactive',
        }),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('topUp.title')}</DialogTitle>
          <DialogDescription>
            {t('topUp.description', { code: intake.code, supplier: supplierName })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field name="amount" label={t('topUp.amount')} required error={errors.amount?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                autoFocus
                {...register('amount', {
                  ...amountRules('topUp.errors.amountFormat'),
                  // The server's CHECK is `amount > 0`, and it refuses a zero
                  // with a sentence about a top-up that changes no debt. Saying
                  // the same thing here saves a round trip; the server is still
                  // the authority.
                  validate: (value: string) => {
                    const normalised = normalizeAmount(value);
                    const shaped = amountRules('topUp.errors.amountFormat').validate(value);
                    if (shaped !== true) return shaped;
                    return Number(normalised) > 0 || 'topUp.errors.amountPositive';
                  },
                })}
              />
            )}
          </Field>

          <Field name="reason" label={t('topUp.reason')} required error={errors.reason?.message}>
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('reason', {
                  required: 'topUp.errors.reasonRequired',
                  maxLength: { value: 500, message: 'topUp.errors.reasonTooLong' },
                  // `\S`, not a length check — the same pair the server applies.
                  validate: (value: string) =>
                    value.trim().length > 0 || 'topUp.errors.reasonRequired',
                })}
              />
            )}
          </Field>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('topUp.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
