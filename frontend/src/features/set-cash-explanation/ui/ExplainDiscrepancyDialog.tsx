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
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { useSetCashExplanationMutation } from '../api/useSetCashExplanation';

interface ExplainFormValues {
  explanation: string;
}

/**
 * §7.7 (ред. 09.09.2026) — розбіжність НІКОЛИ не блокує закриття зміни;
 * приймальник закриває, керівник пояснює постфактум через `PUT
 * /shifts/:id/explanation`. Заголовок називає розмір розбіжності
 * (`discrepancy`), щоб клік не був наосліп — керівник бачить, що саме він
 * зараз пояснює, а не тицяє в порожню кнопку.
 *
 * ПОЯСНЕННЯ НЕ Є ВИПРАВЛЕННЯМ: жодне число не рухається, `discrepancy`
 * лишається в документі таким, яким було.
 */
export function ExplainDiscrepancyDialog({
  shiftId,
  discrepancy,
  open,
  onClose,
}: {
  shiftId: string;
  discrepancy: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const setExplanation = useSetCashExplanationMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ExplainFormValues>({ defaultValues: { explanation: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await setExplanation.mutateAsync({ shiftId, explanation: values.explanation.trim() });
      toast.success(t('cash.toast.explained'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'cash.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('cash.explainDialog.title', {
              amount: formatUah(discrepancy, i18n.resolvedLanguage),
            })}
          </DialogTitle>
          <DialogDescription>{t('cash.explainDialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="explanation"
            label={t('cash.explainDialog.explanation')}
            required
            error={errors.explanation?.message}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('explanation', {
                  required: 'cash.errors.explanationRequired',
                  validate: (value) =>
                    value.trim().length > 0 || 'cash.errors.explanationRequired',
                  maxLength: { value: 2000, message: 'cash.errors.explanationTooLong' },
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
              {t('cash.explainDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
