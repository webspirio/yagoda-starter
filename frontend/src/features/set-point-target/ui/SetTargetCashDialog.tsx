import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
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
import { DECIMAL_INPUT, normalizeAmount, cmp, formatUah } from '@/shared/lib/money';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useSetPointTargetMutation } from '../api/useSetPointTarget';

interface SetTargetFormValues {
  target_cash: string;
  reason: string;
}

/**
 * §6.1 (ред. 03.09.2026) — наділ це звичайне число на точці, без історії:
 * міняє лише керівник (§10.2 — у приймальника цієї кнопки не існує, і це не
 * ця форма вирішує — вона просто ніколи не рендериться на його екрані), перше
 * значення без причини, а НИЖЧЕ ЗА ТЕ, ЩО ВЖЕ НА ТОЧЦІ — З ПОПЕРЕДЖЕННЯМ, а
 * не забороною: наділ це орієнтир, управлінське рішення, а заблокована кнопка
 * лише вчить шукати спосіб її обійти.
 */
export function SetTargetCashDialog({
  pointId,
  pointName,
  currentTarget,
  open,
  onClose,
}: {
  pointId: string;
  pointName: string;
  currentTarget: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const setTarget = useSetPointTargetMutation();
  // Gated on `open`: the page mounts this dialog closed for every owner +
  // point, so an ungated read is one extra request per point picked — for a
  // warning nobody can see until the dialog opens.
  const pointCash = usePointCashForPointQuery(pointId, undefined, open);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetTargetFormValues>({
    defaultValues: { target_cash: currentTarget ?? '', reason: '' },
  });

  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize safely (see `pages/reception`'s own note).
  const typedTarget = useWatch({ control, name: 'target_cash' });
  const normalizedTarget = normalizeAmount(typedTarget);
  const currentCash = pointCash.data?.cash;
  // Fails open by design while the point's cash figure hasn't loaded yet (or
  // errored): `currentCash === undefined` here, so no warning renders rather
  // than a false one — there is nothing yet to compare the typed target to.
  const belowCurrentCash =
    currentCash !== undefined &&
    DECIMAL_INPUT.test(normalizedTarget) &&
    cmp(normalizedTarget, currentCash) === -1;

  // §6.1: «Для першого цільового значення точки причина не потрібна —
  // попереднього рівня не існувало» — `currentTarget: null` is that signal.
  // Reaffirmed as still binding after the 03.09.2026 schema amendment
  // ("Чинним лишається все інше: … перше значення без причини").
  const isFirstTarget = currentTarget === null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await setTarget.mutateAsync({
        pointId,
        target_cash: normalizeAmount(values.target_cash),
        reason: values.reason.trim(),
      });
      toast.success(t('pointTarget.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'pointTarget.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pointTarget.title', { pointName })}</DialogTitle>
          <DialogDescription>{t('pointTarget.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="target_cash"
            label={t('pointTarget.targetCash')}
            required
            error={errors.target_cash?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('target_cash', {
                  required: 'pointTarget.errors.cashFormat',
                  validate: (value) =>
                    DECIMAL_INPUT.test(normalizeAmount(value)) || 'pointTarget.errors.cashFormat',
                })}
                autoFocus
              />
            )}
          </Field>

          {belowCurrentCash && currentCash !== undefined ? (
            <p role="status" className="flex items-start gap-2 text-sm text-amber">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('pointTarget.warnings.belowCash', {
                amount: formatUah(currentCash, i18n.resolvedLanguage),
              })}
            </p>
          ) : null}

          <Field
            name="reason"
            label={t('pointTarget.reason')}
            required={!isFirstTarget}
            error={errors.reason?.message}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('reason', {
                  required: isFirstTarget ? false : 'pointTarget.errors.reasonRequired',
                  validate: (value) =>
                    isFirstTarget ||
                    value.trim().length > 0 ||
                    'pointTarget.errors.reasonRequired',
                  maxLength: { value: 500, message: 'pointTarget.errors.reasonTooLong' },
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
              {t('pointTarget.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
