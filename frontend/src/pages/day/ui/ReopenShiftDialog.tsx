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
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { formatLongDate } from '@/shared/lib/date';
import type { Shift } from '@/entities/shift';
import { useReopenShiftMutation } from '../api/shiftActions';
import { apiErrorToBanner } from '../lib/apiErrorToBanner';

interface ReopenFormValues {
  reason: string;
}

/**
 * Owner-only correction: put a closed day back in play. The REASON IS THE
 * POINT — it is the only trace the reopen leaves outside the audit log, so it
 * is required here and required by the backend DTO, not a courtesy field.
 */
export function ReopenShiftDialog({
  shift,
  open,
  onClose,
}: {
  shift: Shift;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const reopen = useReopenShiftMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReopenFormValues>({ defaultValues: { reason: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await reopen.mutateAsync({ id: shift.id, reason: values.reason.trim() });
      toast.success(t('day.toast.reopened'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('day.reopenDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('day.title', { date: formatLongDate(shift.business_date, i18n.language) })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="reason"
            label={t('day.reopenDialog.reason')}
            hint={t('day.reopenDialog.reasonHint')}
            required
            error={errors.reason?.message}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('reason', {
                  required: 'day.errors.reasonRequired',
                  validate: (v) => v.trim().length > 0 || 'day.errors.reasonRequired',
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
              {t('day.reopenDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
