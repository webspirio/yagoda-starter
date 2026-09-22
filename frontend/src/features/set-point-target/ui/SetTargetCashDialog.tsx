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
import { DECIMAL_INPUT, normalizeAmount, cmp, sub, formatUah, amountRules } from '@/shared/lib/money';
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
 *
 * R7 (2026-09-22) — мок дзеркалить `CashFloatDialog`, МІНУС усе, що
 * суперечить рішенню 03.09: жодного «Діє з», жодної історії наділів, жоден
 * `reason` не читається назад. Що лишається: опис із діючим значенням, жива
 * попередня оцінка (скільки не хвататиме до нового наділу, порахована
 * прямо з типізованого поля — без ефекту), понад-наділова репліка (заміняє
 * стару жовту засторогу, а не додається до неї) і статична примітка, що каса
 * не перераховується заднім числом.
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
  const locale = i18n.resolvedLanguage ?? 'uk';
  const setTarget = useSetPointTargetMutation();
  // Gated on `open`: the page mounts this dialog closed for every owner +
  // point, so an ungated read is one extra request per point picked — for a
  // preview nobody can see until the dialog opens.
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
  // The whole preview below is a RENDER-TIME derivation from this watched
  // value — no `useEffect`, so there is nothing to keep in sync by hand.
  const typedTarget = useWatch({ control, name: 'target_cash' });
  const normalizedTarget = normalizeAmount(typedTarget);
  const isTypedValid = DECIMAL_INPUT.test(normalizedTarget);
  const currentCash = pointCash.data?.cash;

  // Fails open by design while the point's cash figure hasn't loaded yet (or
  // errored): `currentCash === undefined` here, so neither the preview nor
  // the over-target copy render rather than showing something false.
  const isAboveCash = currentCash !== undefined && isTypedValid && cmp(normalizedTarget, currentCash) === 1;
  const isBelowCash = currentCash !== undefined && isTypedValid && cmp(normalizedTarget, currentCash) === -1;
  const shortfall = isAboveCash ? formatUah(sub(normalizedTarget, currentCash), locale) : '—';

  // §6.1: «Для першого цільового значення точки причина не потрібна —
  // попереднього рівня не існувало» — `currentTarget: null` is that signal.
  // Reaffirmed as still binding after the 03.09.2026 schema amendment
  // ("Чинним лишається все інше: … перше значення без причини").
  const isFirstTarget = currentTarget === null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const target_cash = normalizeAmount(values.target_cash);
      await setTarget.mutateAsync({
        pointId,
        target_cash,
        reason: values.reason.trim(),
      });
      toast.success(t('pointTarget.toast.title', { amount: formatUah(target_cash, locale) }), {
        description: t('pointTarget.toast.description', { point: pointName }),
      });
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
          <DialogDescription>
            {currentTarget !== null
              ? t('pointTarget.description.current', { amount: formatUah(currentTarget, locale) })
              : t('pointTarget.description.none')}
          </DialogDescription>
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
                {...register('target_cash', amountRules('pointTarget.errors.cashFormat'))}
                autoFocus
              />
            )}
          </Field>

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

          <div className="rounded-lg border border-line2 bg-muted/40 px-3 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">{t('pointTarget.preview.cashNow')}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {currentCash !== undefined ? formatUah(currentCash, locale) : '—'}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">{t('pointTarget.preview.shortfall')}</span>
              <span className="shrink-0 font-mono font-semibold tabular-nums">{shortfall}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{t('pointTarget.note')}</p>

          {isBelowCash ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('pointTarget.overTarget')}
            </p>
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
              {t('pointTarget.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
