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
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { DECIMAL_INPUT, CRATES_INPUT, normalizeAmount, isZero } from '@/shared/lib/money';
import { useSendTransferMutation } from '../api/useSendTransfer';

interface SendTransferFormValues {
  cash: string;
  crates: string;
  carrier: string;
}

/**
 * §7.9 step 1 — керівник відправляє гроші та порожні ящики на точку.
 * Каркас — `ReopenShiftDialog`.
 */
export function SendTransferDialog({
  pointId,
  pointName,
  open,
  onClose,
}: {
  pointId: string;
  pointName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sendTransfer = useSendTransferMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SendTransferFormValues>({
    defaultValues: { cash: '0', crates: '0', carrier: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const cash = normalizeAmount(values.cash);
    const crates = Number(values.crates.trim());

    // Клієнтська перевірка «не порожній переказ» дзеркалить бекендовий
    // CHK_transfers_not_empty (cash > 0 OR crates > 0) — щоб людина дізналась
    // про це до запиту, а не з 400.
    if (isZero(cash) && crates === 0) {
      setFormError('transfer.errors.notEmpty');
      return;
    }

    try {
      await sendTransfer.mutateAsync({
        collection_point_id: pointId,
        cash,
        crates,
        carrier: values.carrier.trim(),
      });
      toast.success(t('transfer.send.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'transfer.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('transfer.send.title', { pointName })}</DialogTitle>
          <DialogDescription>{t('transfer.send.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field name="cash" label={t('transfer.send.cash')} error={errors.cash?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('cash', {
                  validate: (value) =>
                    DECIMAL_INPUT.test(normalizeAmount(value)) || 'transfer.errors.cashFormat',
                })}
              />
            )}
          </Field>

          <Field name="crates" label={t('transfer.send.crates')} error={errors.crates?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                className="font-mono"
                {...register('crates', {
                  validate: (value) =>
                    CRATES_INPUT.test(value.trim()) || 'transfer.errors.cratesFormat',
                })}
              />
            )}
          </Field>

          <Field
            name="carrier"
            label={t('transfer.send.carrier')}
            required
            error={errors.carrier?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('carrier', {
                  required: 'transfer.errors.carrierRequired',
                  validate: (value) => value.trim().length > 0 || 'transfer.errors.carrierRequired',
                  maxLength: { value: 200, message: 'transfer.errors.carrierTooLong' },
                })}
                autoFocus
              />
            )}
          </Field>

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
              {t('transfer.send.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
