import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
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
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { TraceScope, TraceTerm } from '@/shared/ui/trace';
import { add, cmp, decimalRules, formatKg, formatUah, parseDecimal } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useCreateTopUpMutation } from '../api/useCreateTopUp';

interface TopUpFormValues {
  amount: string;
  reason: string;
}

/**
 * «ФАНТОМНИЙ ЗАЛИШОК» (#61) — the owner adds a fixed amount of supplier debt
 * against a receipt that is already recorded, because a price was renegotiated
 * after the berries were handed over.
 *
 * THERE IS NO DOWNWARD PATH HERE, and that is not an oversight. `amount` is
 * positive only: a negative row would reduce a debt with no cash leaving the
 * drawer, which §3.2 forbids «для ЖОДНОЇ ролі». Correcting a price DOWNWARD
 * stays §9.3 — void the receipt and reissue it at the right price.
 *
 * THE REASON IS THE FEATURE. #61 asks for it in as many words: «щоб при
 * перегляді історії було ясно зрозуміло, чому ми маємо викладати дві тисячі
 * цьому постачальнику». It is required, and required NON-BLANK — a reason of
 * three spaces passes a length check and leaves whitespace standing as the
 * explanation for a two-thousand-hryvnia debt, which is why the server tests
 * `\S` and so does this form.
 *
 * WHAT IT IS FOR AND WHAT IT CHANGES, said before the click (review 2026-10-24
 * #4): the receipt's own facts (code, date, berries, kg, sum), «Залишок: X → Y»
 * live as the amount is typed (X is the card's own settlement `debt`, passed
 * in — this dialog reads nothing), which day's «Собівартість» it lands in, that
 * it is never printed and can only be voided, and an amber warning when the
 * top-up outgrows the receipt itself — a typo of a zero, almost always.
 *
 * The parent remounts it via a changing `key` on every open, so there is no
 * reset effect.
 */
export function TopUpDialog({
  intake,
  supplierName,
  balanceBefore,
  open,
  onClose,
}: {
  /** The receipt this money is for. Its code is what the owner recognises — a
   *  top-up has no code of its own and never will. `items` (the card asks
   *  `expand=items`) names the berries; without them the row is left out. */
  intake: {
    id: string;
    code: string;
    business_date: string;
    amount: string;
    net_kg: string;
    items?: readonly { product_name: string }[];
  };
  supplierName: string;
  /** The supplier's balance right now — the card's settlement `debt`. */
  balanceBefore: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const money = (v: string) => formatUah(v, locale);
  const createTopUp = useCreateTopUpMutation();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TopUpFormValues>({ defaultValues: { amount: '', reason: '' } });

  // Only a well-formed positive amount moves the preview; anything else shows «Залишок: X».
  const typed = parseDecimal(useWatch({ control, name: 'amount' }));
  const amount = typed !== null && cmp(typed, '0') === 1 ? typed : null;
  const tooBig = amount !== null && cmp(amount, intake.amount) === 1;
  const products = [...new Set((intake.items ?? []).map((i) => i.product_name))].join(', ');
  const date = formatShortDate(intake.business_date, locale);
  const before = (
    <TraceTerm refs="topUp:before" tone="amber" hint={t('topUp.trace.before')}>
      {null}
    </TraceTerm>
  );

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createTopUp.mutateAsync({
        intake_id: intake.id,
        amount: values.amount,
        reason: values.reason.trim(),
      });
      toast.success(t('topUp.toast.created'));
      onClose();
    } catch (error) {
      setFormError(
        apiErrorToBanner(error, 'topUp.errors.failed', {
          // Shared code, screen-specific consequence — see `apiErrorToBanner`.
          SUPPLIER_INACTIVE: 'topUp.errors.supplierInactive',
        }),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('topUp.title')}</DialogTitle>
          <DialogDescription>
            {t('topUp.description', { supplier: supplierName })}
          </DialogDescription>
        </DialogHeader>

        <TraceScope>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line2 bg-muted/40 px-3 py-2 text-sm">
            <dt className="text-muted-foreground">{t('topUp.facts.receipt')}</dt>
            <dd className="font-mono">{intake.code}</dd>
            <dt className="text-muted-foreground">{t('topUp.facts.date')}</dt>
            <dd className="font-mono tabular-nums">{date}</dd>
            {products ? (
              <>
                <dt className="text-muted-foreground">{t('topUp.facts.products')}</dt>
                <dd>{products}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('topUp.facts.net')}</dt>
            <dd className="font-mono tabular-nums">{formatKg(intake.net_kg, locale)}</dd>
            <dt className="text-muted-foreground">{t('topUp.facts.amount')}</dt>
            <dd className="font-mono tabular-nums" data-trace="topUp:receipt">
              {money(intake.amount)}
            </dd>
          </dl>

          <p className="text-xs text-muted-foreground">{t('topUp.note', { date })}</p>

          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field name="amount" label={t('topUp.amount')} required error={errors.amount?.message}>
              {(a11y) => (
                <DecimalInput
                  {...a11y}
                  className="font-mono"
                  data-trace="topUp:amount"
                  autoFocus
                  {...register('amount', {
                    ...decimalRules(),
                    // The server's CHECK is `amount > 0`, and it refuses a zero
                    // with a sentence about a top-up that changes no debt. Saying
                    // the same thing here saves a round trip; the server is still
                    // the authority.
                    validate: (value: string) => {
                      const shaped = decimalRules().validate(value);
                      if (shaped !== true) return shaped;
                      const amount = parseDecimal(value);
                      return (
                        (amount !== null && cmp(amount, '0') === 1) || 'topUp.errors.amountPositive'
                      );
                    },
                  })}
                />
              )}
            </Field>

            <Field name="reason" label={t('topUp.reason')} required error={errors.reason?.message}>
              {(a11y) => (
                <Textarea
                  {...a11y}
                  placeholder={t('topUp.reasonPlaceholder')}
                  {...register('reason', {
                    required: 'topUp.errors.reasonRequired',
                    maxLength: { value: 500, message: 'topUp.errors.reasonTooLong' },
                    // `\S`, not a length check — the same pair the server applies.
                    validate: (value: string) =>
                      value.trim().length > 0 || 'topUp.errors.reasonRequired',
                  })}
                />
              )}
            </Field>

            {tooBig ? (
              <p role="status" className="text-sm text-[var(--amber)]">
                <Trans
                  i18nKey="topUp.tooBig"
                  values={{ amount: money(intake.amount) }}
                  components={{
                    amount: (
                      <TraceTerm refs="topUp:receipt" tone="amber" hint={t('topUp.trace.receipt')}>
                        {null}
                      </TraceTerm>
                    ),
                  }}
                />
              </p>
            ) : null}

            <p className="text-sm" aria-live="polite">
              {amount === null ? (
                <Trans
                  i18nKey="topUp.balanceNow"
                  values={{ before: money(balanceBefore) }}
                  components={{ before }}
                />
              ) : (
                <Trans
                  i18nKey="topUp.balance"
                  values={{
                    before: money(balanceBefore),
                    after: money(add(balanceBefore, amount)),
                  }}
                  components={{
                    before,
                    after: (
                      <TraceTerm
                        refs={['topUp:before', 'topUp:amount']}
                        tone="amber"
                        hint={t('topUp.trace.after')}
                      >
                        {null}
                      </TraceTerm>
                    ),
                  }}
                />
              )}
            </p>

            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {t(formError)}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {t('topUp.submit')}
              </Button>
            </DialogFooter>
          </form>
        </TraceScope>
      </DialogContent>
    </Dialog>
  );
}
