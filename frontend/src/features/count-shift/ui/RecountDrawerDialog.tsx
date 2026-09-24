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
import { amountRules, maskDecimalInput, normalizeAmount, isZero } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import type { CashCount } from '@/entities/cash-count';
import { useRecountMutation } from '../api/recount';
import { CountResultBody } from './CountResultView';

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
 * ONE `Dialog`, whose `DialogContent` swaps its body between the form and
 * the result (review round 3 — TWO sibling `Dialog`s, open/closed in
 * lockstep via `open={open && result === null}` / `open={open && result !==
 * null}`, briefly put TWO `role="dialog"` elements in the DOM at once: the
 * first one keeps rendering through its own exit animation
 * (`shared/ui/dialog.tsx`'s `data-[state=closed]` transition) at the exact
 * moment the second one mounts already `data-state="open"`). The result
 * body is `CountResultBody` — the SAME markup `CountResultView`
 * (`pages/point-cash`'s open/close result) wraps in its own `Dialog` (review
 * round 1 folded what used to be two near-copies into one, feature-owned
 * component; a `features/*` module cannot import from `pages/*`, so this is
 * the one place both callers can share it from) — rendered directly inside
 * THIS dialog's own `DialogContent` rather than in a second `Dialog`.
 *
 * `result`/`formError` — internal state; the caller resets them by
 * remounting this component via `key` on every new open, the same
 * convention `CountDrawerDialog`'s own callers already follow.
 */
export function RecountDrawerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const recount = useRecountMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<CashCount | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecountFormValues>({ defaultValues: { amount: '' } });

  // Masked the same way `TotalsSection`'s «Видано готівкою» field is
  // (comma or dot, two decimals, no letters) — wrapped around RHF's own
  // `onChange` rather than replacing it, since this field stays an
  // uncontrolled `register()` input; on-submit validation (`amountRules`)
  // is unchanged.
  const amountField = register('amount', amountRules('recount.errors.amount'));

  const submit = async (values: RecountFormValues) => {
    try {
      const row = await recount.mutateAsync({ counted_amount: normalizeAmount(values.amount) });
      setResult(row);
    } catch (error) {
      // NO_OPEN_SHIFT — the contract this dialog refuses on (409, aligned
      // with intakes/payouts/transfers/crates) — gets the recount's OWN
      // sentence here (`recount.errors.noOpenShift`), not the shared
      // `transfer.errors.noOpenShift` wording `apiErrorToBanner`'s CODE map
      // answers with at every other call site, and not `recount.errors.amount`
      // either (review, minor 11): that key is the client-side VALIDATION
      // message for the amount field, and doubling it as the server refusal
      // banner too was itself a wrong claim — `0` is a legal count, so
      // "enter an amount greater than zero" was never the actual rule.
      setFormError(
        apiErrorToBanner(error, 'recount.errors.failed', {
          NO_OPEN_SHIFT: 'recount.errors.noOpenShift',
        }),
      );
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        {result ? (
          <CountResultBody
            title={t('recount.title')}
            expected={result.expected_amount}
            counted={result.counted_amount}
            discrepancy={result.discrepancy}
            // §7.7 — a discrepancy never blocks anything; it only means this
            // figure cannot be edited here, and the owner sees it explained
            // on their own list, not that something needs fixing NOW.
            note={!isZero(result.discrepancy) ? t('recount.result.note') : null}
            onClose={handleClose}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('recount.title')}</DialogTitle>
              <DialogDescription>{t('recount.body')}</DialogDescription>
            </DialogHeader>

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
                    {...amountField}
                    onChange={(e) => {
                      e.target.value = maskDecimalInput(e.target.value);
                      void amountField.onChange(e);
                    }}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
