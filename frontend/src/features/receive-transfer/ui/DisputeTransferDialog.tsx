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
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { DECIMAL_INPUT, CRATES_INPUT, normalizeAmount, formatUah } from '@/shared/lib/money';
import type { Transfer } from '@/entities/transfer';
import { useDisputeTransferMutation } from '../api/useReceiveTransfer';

interface DisputeFormValues {
  reported_cash: string;
  reported_crates: string;
  dispute_note: string;
}

/**
 * §7.9 step 4б — «Не сходиться». Точка пише, скільки нарахувала насправді, і
 * нотатку.
 *
 * НА ВІДМІНУ ВІД ПІДРАХУНКУ ШУХЛЯДИ (`CountDrawerDialog`, де очікуване
 * навмисно НЕ показане, бо підрахунок — це сліпий контроль), тут показ
 * відправленого (`transfer.cash`/`transfer.crates`) ПРАВИЛЬНИЙ: відповідь на
 * переказ — це звірка з накладною, а не сліпий контроль.
 */
export function DisputeTransferDialog({
  transfer,
  open,
  onClose,
}: {
  transfer: Transfer;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const disputeTransfer = useDisputeTransferMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DisputeFormValues>({
    // `reported_cash` starts BLANK — cash is the figure that usually
    // disagrees, and the point must type what it actually counted rather
    // than silently keep the sent one. `reported_crates` starts at the sent
    // count: crates rarely differ from what travelled, and a point disputing
    // only the cash should not also have to retype an unchanged crate count.
    defaultValues: {
      reported_cash: '',
      reported_crates: String(transfer.crates),
      dispute_note: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await disputeTransfer.mutateAsync({
        id: transfer.id,
        reported_cash: normalizeAmount(values.reported_cash),
        reported_crates: Number(values.reported_crates.trim()),
        dispute_note: values.dispute_note.trim(),
      });
      toast.success(t('transfer.dispute.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'transfer.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('transfer.dispute.title')}</DialogTitle>
          <DialogDescription>
            {t('transfer.dispute.sent', {
              uah: formatUah(transfer.cash, i18n.resolvedLanguage),
              crates: transfer.crates,
            })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="reported_cash"
            label={t('transfer.dispute.reportedCash')}
            required
            error={errors.reported_cash?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('reported_cash', {
                  required: 'transfer.errors.cashFormat',
                  validate: (value) =>
                    DECIMAL_INPUT.test(normalizeAmount(value)) || 'transfer.errors.cashFormat',
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="reported_crates"
            label={t('transfer.dispute.reportedCrates')}
            required
            error={errors.reported_crates?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                className="font-mono"
                {...register('reported_crates', {
                  required: 'transfer.errors.cratesFormat',
                  validate: (value) =>
                    CRATES_INPUT.test(value.trim()) || 'transfer.errors.cratesFormat',
                })}
              />
            )}
          </Field>

          <Field
            name="dispute_note"
            label={t('transfer.dispute.note')}
            required
            error={errors.dispute_note?.message}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('dispute_note', {
                  required: 'transfer.errors.noteRequired',
                  validate: (value) => value.trim().length > 0 || 'transfer.errors.noteRequired',
                  maxLength: { value: 500, message: 'transfer.errors.noteTooLong' },
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
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('transfer.dispute.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
