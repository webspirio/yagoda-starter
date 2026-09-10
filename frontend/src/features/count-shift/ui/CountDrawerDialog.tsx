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
import { DECIMAL_INPUT, normalizeAmount } from '@/shared/lib/money';
import { apiErrorToBanner } from '../lib/apiErrorToBanner';

interface CountFormValues {
  amount: string;
}

/**
 * ЧОМУ ТУТ НЕ ПОКАЗАНО «ОЧІКУВАНО». Спокуса поставити поруч `expected_amount`
 * велика і вона знищує сенс дії: підрахунок — це контроль, а людина, яка
 * бачить очікуване число, впише саме його. Очікуване й розбіжність з'являються
 * ПІСЛЯ запису — у тості й на «Касі точки».
 */
export function CountDrawerDialog({
  mode,
  open,
  onClose,
  onConfirm,
}: {
  mode: 'open' | 'close';
  open: boolean;
  onClose: () => void;
  /** Викликається з нормалізованою сумою; кидає — діалог покаже банер і лишиться відкритим. */
  onConfirm: (countedAmount: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CountFormValues>({ defaultValues: { amount: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onConfirm(normalizeAmount(values.amount));
    } catch (error) {
      setFormError(apiErrorToBanner(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(mode === 'open' ? 'day.count.openTitle' : 'day.count.closeTitle')}</DialogTitle>
          <DialogDescription>
            {t(mode === 'open' ? 'day.count.openBody' : 'day.count.closeBody')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="amount"
            label={t('day.count.amount')}
            required
            error={errors.amount?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('amount', {
                  required: 'day.errors.countFormat',
                  validate: (value) =>
                    DECIMAL_INPUT.test(normalizeAmount(value)) || 'day.errors.countFormat',
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
              {t('day.count.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
