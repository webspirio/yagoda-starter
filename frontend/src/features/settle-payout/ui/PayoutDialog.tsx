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
import { DecimalInput } from '@/shared/ui/decimal-input';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { Spinner } from '@/shared/ui/spinner';
import {
  cmp,
  isZero,
  formatUah,
  parseDecimal,
  decimalRules,
  toDecimalField,
} from '@/shared/lib/money';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useCurrentShiftQuery } from '@/entities/shift';
import type { Payout } from '@/entities/payout';
import { useCreatePayoutMutation } from '../api/useCreatePayout';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { PayoutFormValues } from '../model/payoutForm';

/** What the dialog knows about the drawer it pays from — `null` cash is
 *  UNKNOWN (a failed read), never an empty drawer. */
interface Ceiling {
  /** min(debt, max(0, cash)) — or the debt alone while the cash is unknown. */
  max: string;
  cash: string | null;
}

/**
 * The §3.6 ceiling: `min(Разом, каса за ягоду)`. A negative drawer admits
 * nothing (`payout-writer.ts` refuses any amount above it), so it clamps to 0.
 */
function ceilingOf(debt: string, cash: string | null): Ceiling {
  if (cash === null) return { max: debt, cash };
  const drawer = cmp(cash, '0') === 1 ? cash : '0.00';
  return { max: cmp(debt, drawer) === 1 ? drawer : debt, cash };
}

/**
 * Payout dialog — records money handed to a supplier as a standalone
 * document (never a field on an intake; spec §5.5). The server's ceiling is
 * DOUBLE (§3.6, `payout-writer.ts`): the supplier's debt AND the point's
 * berry cash, and it refuses outright without an open shift at the point.
 * The dialog mirrors all three before a click rather than after one: it reads
 * the point's open shift (`entities/shift`) and its cash
 * (`entities/point-cash`, the same `GET /point-cash/:pointId` reception
 * caps «Видано готівкою» with), prefills `min(debt, cash)`, names the drawer
 * when it is the tighter bound, and keeps «Видати» disabled above it. The
 * server still holds a row lock and re-checks both under it — two payouts
 * racing one drawer is exactly what that lock exists for — so its
 * `PAYOUT_EXCEEDS_CASH`/`NO_OPEN_SHIFT` stay mapped for the race.
 *
 * `pointId` is the supplier's own point (§3.9 — a balance is paid only where
 * it was run up): the drawer is read there and `collection_point_id` travels
 * with the request (for an operator the server resolves the same point from
 * the token).
 *
 * THERE IS NO RECEIPT-NUMBER FIELD. The operator used to copy one in off the
 * paper payout book; since 2026-09-18 the server numbers the shift itself
 * (`common/document-code.ts`) and the number comes back on the response, to be
 * written onto the paper rather than read off it. The amount stayed: §3.7
 * allows any sum from 0 to «Разом», and only the person at the counter knows
 * which one is leaving the drawer.
 *
 * The parent remounts it via a changing `key` on every open; the form itself
 * mounts only once the drawer is known, so its prefill is the real ceiling.
 */
export function PayoutDialog({
  supplier,
  pointId,
  debt,
  defaultAmount,
  open,
  onClose,
  onPaid,
}: {
  supplier: { id: string; first_name: string; last_name: string };
  /** The supplier's point — where the drawer is read and the payout written. */
  pointId: string;
  /** The supplier's current balance (Σ intakes − Σ payouts) — one of the two
   *  ceilings and, capped by the cash, the default prefill. */
  debt: string;
  /** Pre-fills the amount with something other than the full debt (still
   *  capped by the ceiling). */
  defaultAmount?: string;
  open: boolean;
  onClose: () => void;
  onPaid?: (payout: Payout) => void;
}) {
  const { t } = useTranslation();
  // Owned here, not in the form, so a dismiss mid-request is refused at the
  // dialog itself (the form's own `isSubmitting` sits below it).
  const createPayout = useCreatePayoutMutation();
  // Both reads wait for the dialog to open: the supplier card mounts it closed.
  const shift = useCurrentShiftQuery(open ? pointId : null);
  const pointCash = usePointCashForPointQuery(pointId, undefined, open);
  const name = `${supplier.first_name} ${supplier.last_name}`;

  // A failed shift read is not «no shift»: the form stays, and the server's
  // own NO_OPEN_SHIFT banner covers the case it could not see.
  const noShift = !shift.isPending && !shift.isError && shift.data === null;
  const waiting = shift.isPending || (pointCash.isPending && !pointCash.isError);
  // ONE derived value, the same ruling reception makes: a refetch that failed
  // keeps the old `data` — a figure known to be stale is not a cap.
  const cash = pointCash.isError ? null : (pointCash.data?.cash ?? null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !createPayout.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payout.form.title', { name })}</DialogTitle>
          <DialogDescription>{t('payout.form.description')}</DialogDescription>
        </DialogHeader>

        {noShift ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {t('payout.noShift')}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </>
        ) : waiting ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <PayoutForm
            supplierId={supplier.id}
            pointId={pointId}
            debt={debt}
            ceiling={ceilingOf(debt, cash)}
            defaultAmount={defaultAmount}
            createPayout={createPayout}
            onClose={onClose}
            onPaid={onPaid}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayoutForm({
  supplierId,
  pointId,
  debt,
  ceiling,
  defaultAmount,
  createPayout,
  onClose,
  onPaid,
}: {
  supplierId: string;
  pointId: string;
  debt: string;
  ceiling: Ceiling;
  defaultAmount?: string;
  createPayout: Pick<ReturnType<typeof useCreatePayoutMutation>, 'mutateAsync'>;
  onClose: () => void;
  onPaid?: (payout: Payout) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const wanted = defaultAmount ?? debt;
  const prefill = cmp(wanted, ceiling.max) === 1 ? ceiling.max : wanted;

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<PayoutFormValues>({
    // Shown the way the screen prints money («500,00» in uk); read back
    // through `parseDecimal` below, since a prefill is stored as given.
    defaultValues: { amount: toDecimalField(prefill, locale) },
  });

  const [formError, setFormError] = useState<string | null>(null);

  // The button names the typed sum — never the full balance under a value
  // (or an empty field) the form is about to refuse. The field opens
  // prefilled, so a freshly opened dialog still reads «Видати 10 944,00 ₴».
  const submitAmount = parseDecimal(useWatch({ control, name: 'amount' }));

  // Which bound the typed sum crosses, said on the field AS IT IS TYPED — the
  // submit is disabled above the ceiling, so a click could never say it.
  const overDebt = submitAmount !== null && cmp(submitAmount, debt) === 1;
  const overCash = !overDebt && submitAmount !== null && cmp(submitAmount, ceiling.max) === 1;
  const nothingToPay = isZero(ceiling.max);
  const cashLimits = ceiling.cash !== null && cmp(ceiling.max, debt) === -1;

  const liveError = overDebt
    ? 'payout.errors.exceedsDebt'
    : overCash
      ? 'payout.errors.exceedsCashLimit'
      : undefined;
  const fieldError = errors.amount?.message ?? liveError;
  const cashUah = ceiling.cash === null ? '' : formatUah(ceiling.cash, locale);

  const hint =
    ceiling.cash === null
      ? t('payout.cashUnknown')
      : nothingToPay
        ? t('payout.cashEmpty', { cash: cashUah, debt: formatUah(debt, locale) })
        : cashLimits
          ? t('payout.cashHint', { cash: cashUah })
          : undefined;

  const setAll = () => {
    setValue('amount', toDecimalField(ceiling.max, locale));
    clearErrors('amount');
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    // The prefill and «Усе» hold the locale's form; `validate` already
    // refused anything `parseDecimal` cannot read, so the fallback never fires.
    const amount = parseDecimal(values.amount) ?? values.amount;

    if (cmp(amount, '0') !== 1) {
      setError('amount', { message: 'payout.errors.amountZero' });
      return;
    }
    if (cmp(amount, debt) === 1) {
      setError('amount', { message: 'payout.errors.exceedsDebt' });
      return;
    }
    if (cmp(amount, ceiling.max) === 1) {
      setError('amount', { message: 'payout.errors.exceedsCashLimit' });
      return;
    }

    try {
      const payout = await createPayout.mutateAsync({
        supplier_id: supplierId,
        amount,
        collection_point_id: pointId,
      });
      toast.success(t('payout.toast.paid', { uah: formatUah(amount, locale) }));
      onPaid?.(payout);
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof PayoutFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field
        name="amount"
        label={t('payout.form.amount')}
        required
        hint={hint}
        hintTone={cashLimits || nothingToPay ? 'warning' : 'muted'}
        error={fieldError}
        errorParams={
          fieldError === 'payout.errors.exceedsDebt'
            ? { debt: formatUah(debt, locale) }
            : fieldError === 'payout.errors.exceedsCashLimit'
              ? { cash: cashUah }
              : undefined
        }
      >
        {(a11y) => (
          <DecimalInput
            {...a11y}
            className="font-mono"
            {...register('amount', decimalRules())}
            autoFocus
          />
        )}
      </Field>

      <Button
        type="button"
        variant="outline"
        disabled={isSubmitting || nothingToPay}
        onClick={setAll}
      >
        {t('payout.allButton', { uah: formatUah(ceiling.max, locale) })}
      </Button>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(formError)}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting || nothingToPay || overDebt || overCash}>
          {submitAmount === null || nothingToPay
            ? t('payout.submitPlain')
            : t('payout.submit', { uah: formatUah(submitAmount, locale) })}
        </Button>
      </DialogFooter>
    </form>
  );
}
