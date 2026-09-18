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
import { normalizeAmount, amountRules, cratesRules } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useCrateDispatchQuery } from '../api/crateDispatch';

interface CountFormValues {
  amount: string;
  /** Тримається РЯДКОМ, як і сума: порожнє поле мусить лишатись порожнім, а
   *  не ставати `0` через числовий інпут. `0` вписує людина. */
  broken: string;
}

/**
 * ЧОМУ ТУТ НЕ ПОКАЗАНО «ОЧІКУВАНО». Спокуса поставити поруч `expected_amount`
 * велика і вона знищує сенс дії: підрахунок — це контроль, а людина, яка
 * бачить очікуване число, впише саме його. Очікуване й розбіжність з'являються
 * ПІСЛЯ запису — у тості й на «Касі точки».
 */
export function CountDrawerDialog({
  mode,
  shiftId,
  open,
  onClose,
  onConfirm,
}: {
  mode: 'open' | 'close';
  /** Зміна, яку закривають — для §6.8's «з ягодою». `null` у режимі відкриття,
   *  де ще нема про що питати; запит тоді просто вимкнено. */
  shiftId: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * Викликається з нормалізованою сумою і боєм; кидає — діалог покаже банер і
   * лишиться відкритим. `brokenCrates` — `null` ЛИШЕ в режимі відкриття:
   * закриття завжди несе число, і `0` серед них (§6.8).
   */
  onConfirm: (countedAmount: string, brokenCrates: number | null) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const closing = mode === 'close';

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CountFormValues>({ defaultValues: { amount: '', broken: '' } });

  // ЧИТАННЯ, А НЕ УМОВА. Якщо воно впаде або ще не приїхало, «з ягодою» показує
  // риску, а закриття лишається доступним: підпис під шухлядою не може залежати
  // від похідного числа.
  const dispatch = useCrateDispatchQuery(closing ? shiftId : null);
  const withBerry = dispatch.data?.with_berry ?? null;
  // `useWatch`, not `watch()` — the same choice `PayoutDialog` and
  // `IssueCratesDialog` make: `watch()` returns a function the React Compiler
  // cannot memoize, so it skips compiling the whole component.
  const typedBroken = useWatch({ control, name: 'broken' }).trim();
  // Ціла арифметика над лічильником ящиків — `money.ts` тут ні до чого.
  const brokenNumber = /^\d{1,7}$/.test(typedBroken) ? Number.parseInt(typedBroken, 10) : null;
  const dispatched =
    withBerry !== null && brokenNumber !== null ? withBerry + brokenNumber : null;
  const dash = '—';

  const submit = async (values: CountFormValues) => {
    try {
      await onConfirm(
        normalizeAmount(values.amount),
        // Не `Number(...) || 0` і не falsy-перевірка: `0` це відповідь.
        closing ? Number.parseInt(values.broken.trim(), 10) : null,
      );
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'day.errors.failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(mode === 'open' ? 'day.count.openTitle' : 'day.count.closeTitle')}</DialogTitle>
          <DialogDescription>
            {t(mode === 'open' ? 'day.count.openBody' : 'day.count.closeBody')}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            // Cleared at the START of every attempt — not inside the validated
            // callback — so a server banner from a refused submit doesn't
            // survive a later attempt that client validation refuses first
            // (handleSubmit never calls `submit`, so it would never clear).
            setFormError(null);
            void handleSubmit(submit)(event);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
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
                {...register('amount', amountRules('day.errors.countFormat'))}
                autoFocus
              />
            )}
          </Field>

          {closing ? (
            <Field
              name="broken"
              label={t('day.count.broken')}
              required
              error={errors.broken?.message}
            >
              {(a11y) => (
                <TextInput
                  {...a11y}
                  inputMode="numeric"
                  className="font-mono"
                  {...register('broken', cratesRules('day.errors.brokenFormat'))}
                />
              )}
            </Field>
          ) : null}

          {closing ? (
            <dl className="flex flex-col gap-1 border-t border-line2 pt-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">{t('day.count.withBerry')}</dt>
                <dd className="font-mono">{withBerry === null ? dash : withBerry}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">{t('day.count.brokenSummary')}</dt>
                <dd className="font-mono">{brokenNumber === null ? dash : brokenNumber}</dd>
              </div>
              <div className="flex items-baseline justify-between font-medium">
                <dt>{t('day.count.dispatched')}</dt>
                <dd className="font-mono">{dispatched === null ? dash : dispatched}</dd>
              </div>
            </dl>
          ) : null}

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
