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
import { DECIMAL_INPUT, normalizeAmount } from '@/shared/lib/money';
import type { Transfer } from '@/entities/transfer';
import { useResolveTransferMutation } from '../api/useResolveTransfer';

/** Ціле число ящиків, 0 або більше — дзеркалить `@IsInt() @Min(0)` DTO. */
const CRATES_INPUT = /^\d{1,7}$/;

interface ResolveFormValues {
  resolved_cash: string;
  resolved_crates: string;
}

/**
 * §7.9 step 4б — керівник закриває спір.
 *
 * ДЕФОЛТ САМЕ `reported_*`, НЕ `transfer.cash`/`transfer.crates`: доки спір не
 * вирішено, каса точки й так рахує ЇЇ ВЛАСНЕ число (§7.9 у редакції
 * 09.09.2026 — гроші зараховуються в сумі, яку фактично отримали). Дефолт, що
 * дорівнює відправленому, тихо переписав би цю суму.
 */
export function ResolveTransferDialog({
  transfer,
  open,
  onClose,
}: {
  transfer: Transfer;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const resolveTransfer = useResolveTransferMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResolveFormValues>({
    defaultValues: {
      resolved_cash: transfer.reported_cash ?? '0.00',
      resolved_crates: String(transfer.reported_crates ?? 0),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await resolveTransfer.mutateAsync({
        id: transfer.id,
        resolved_cash: normalizeAmount(values.resolved_cash),
        resolved_crates: Number(values.resolved_crates.trim()),
      });
      toast.success(t('transfer.resolve.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'transfer.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('transfer.resolve.title')}</DialogTitle>
          <DialogDescription>
            {t('transfer.resolve.note', { note: transfer.dispute_note })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="resolved_cash"
            label={t('transfer.resolve.resolvedCash')}
            required
            error={errors.resolved_cash?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('resolved_cash', {
                  required: 'transfer.errors.cashFormat',
                  validate: (value) =>
                    DECIMAL_INPUT.test(normalizeAmount(value)) || 'transfer.errors.cashFormat',
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="resolved_crates"
            label={t('transfer.resolve.resolvedCrates')}
            required
            error={errors.resolved_crates?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                className="font-mono"
                {...register('resolved_crates', {
                  required: 'transfer.errors.cratesFormat',
                  validate: (value) =>
                    CRATES_INPUT.test(value.trim()) || 'transfer.errors.cratesFormat',
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
              {t('transfer.resolve.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
