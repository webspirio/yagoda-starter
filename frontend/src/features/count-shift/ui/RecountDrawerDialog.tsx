import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
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
import { Badge } from '@/shared/ui/badge';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { amountRules, normalizeAmount, formatUah, isZero } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import type { CashCount } from '@/entities/cash-count';
import { useRecountMutation } from '../api/recount';

interface RecountFormValues {
  amount: string;
}

/**
 * §7.6's midday recount — «скільки завгодно разів на день», кожен лишається
 * окремим записом і нічого не виправляє. Навмисно не показує, скільки МАЄ
 * бути в шухляді, поки не введено число: `expected_amount` з'являється лише
 * в результаті, з тієї самої причини, яку `CountDrawerDialog` вже документує
 * для відкриття й закриття.
 *
 * Веде свою мутацію сам (на відміну від `CountDrawerDialog`, яку керує
 * `onConfirm` виклику) — у цього діалогу один викликач (`ShiftCountPanel`) і
 * нічого понад «записати підрахунок і показати, що повернулось», тож
 * підіймати цю логіку на рівень сторінки нема сенсу.
 *
 * Результат (`result`) і банер (`formError`) — внутрішній стан; викликач
 * скидає їх, ремонтуючи діалог через `key` на кожному новому відкритті —
 * той самий підхід, який уже застосовують виклики `CountDrawerDialog`.
 */
export function RecountDrawerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const recount = useRecountMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<CashCount | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecountFormValues>({ defaultValues: { amount: '' } });

  const submit = async (values: RecountFormValues) => {
    try {
      const row = await recount.mutateAsync({ counted_amount: normalizeAmount(values.amount) });
      setResult(row);
    } catch (error) {
      // NO_OPEN_SHIFT — the contract this dialog refuses on (409, aligned
      // with intakes/payouts/transfers/crates) — gets the recount's OWN
      // sentence here, not the shared `transfer.errors.noOpenShift` wording
      // `apiErrorToBanner`'s CODE map answers with at every other call site.
      setFormError(
        apiErrorToBanner(error, 'recount.errors.failed', { NO_OPEN_SHIFT: 'recount.errors.amount' }),
      );
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const discrepancyTone = result && isZero(result.discrepancy) ? 'leaf' : 'destructive';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recount.title')}</DialogTitle>
          {result === null ? <DialogDescription>{t('recount.body')}</DialogDescription> : null}
        </DialogHeader>

        {result ? (
          <>
            <dl className="flex flex-col gap-1">
              <LedgerRow
                label={t('recount.result.expected')}
                value={formatUah(result.expected_amount, locale)}
              />
              <LedgerRow
                label={t('recount.result.counted')}
                value={formatUah(result.counted_amount, locale)}
                strong
              />
            </dl>
            <div>
              <Badge
                variant="outline"
                className={
                  discrepancyTone === 'leaf'
                    ? 'border-leaf/40 text-leaf'
                    : 'border-destructive/40 text-destructive'
                }
              >
                {discrepancyTone === 'leaf' ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : (
                  <TriangleAlert aria-hidden="true" />
                )}
                {t('recount.result.discrepancy')}
              </Badge>
            </div>
            {/* §7.7 — a discrepancy never blocks anything; it only means this
                figure cannot be edited here, and the owner sees it explained
                on their own list, not that something needs fixing NOW. */}
            {discrepancyTone === 'destructive' ? (
              <p className="text-sm text-muted-foreground">{t('recount.result.note')}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={handleClose}>
                {t('recount.done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              // Cleared at the START of every attempt, same convention
              // `CountDrawerDialog` documents — a stale server banner must
              // not survive a later attempt client validation refuses first.
              setFormError(null);
              void handleSubmit(submit)(event);
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <Field
              name="amount"
              label={t('recount.amount')}
              required
              error={errors.amount?.message}
            >
              {(a11y) => (
                <TextInput
                  {...a11y}
                  inputMode="decimal"
                  className="font-mono"
                  {...register('amount', amountRules('recount.errors.amount'))}
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
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {t('recount.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
