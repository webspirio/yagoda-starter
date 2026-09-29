import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TextInput } from '@/shared/ui/text-input';
import { toast } from '@/shared/ui/toast';
import { DECIMAL_INPUT, formatUah, maskDecimalInput } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import {
  useCreateDayExpenseMutation,
  useDeleteDayExpenseMutation,
  useUpdateDayExpenseMutation,
  type DayExpense,
} from '@/entities/day-expense';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * `maskDecimalInput` is a TYPING mask, not a validator: '.' and '12.' both
 * survive it mid-keystroke, and `CreateDayExpenseDto`'s
 * `@Matches(/^\d{1,10}(\.\d{1,2})?$/)` refuses both — as a 400 that reaches
 * the person as «щось пішло не так», which says nothing about which field was
 * wrong. Gate on the same `DECIMAL_INPUT` shape `amountRules` submits against
 * everywhere else in this repo, so the refusal is a disabled button instead.
 * (`DECIMAL_INPUT` stops two digits SHORT of the DTO on purpose — `input.ts`
 * says why: 99 999 999,99 ₴ of пальне is a missed key, not a day.)
 *
 * The mask has already done `normalizeAmount`'s work — comma to dot, spaces
 * dropped — on every keystroke, so the raw state is what gets tested.
 */
const isAmount = (value: string) => DECIMAL_INPUT.test(value);

/**
 * §8.3's «Витрати дня» and §8.4's КОШИК — «Права (ВИТРАТИ) — єдине місце
 * вводу». Everything writable on this screen is in this component.
 *
 * INLINE EDIT IS HERE ON PURPOSE, and the reference screen has only add and
 * delete. `day_expenses` is the schema's one mutable money table: §2.7 freezes
 * a document to protect a supplier's printed receipt, and nothing is printed
 * for «пальне 1 000,00». The patch sends ONLY the field that moved, because
 * the server writes an audit entry only when a value really changed and that
 * trail is the sole compensating control for the table being mutable at all.
 *
 * THE FORM IS NOT CLEARED ON A REFUSAL. A line that disappears without a word
 * leaves the собівартість computed without it, silently — the one outcome
 * this screen must never produce.
 *
 * WHEN `per_kg` IS NULL nothing but the manual expenses is named. The day's
 * weight would otherwise read as one enormous недостача, and «недостача
 * 17 419,07 ₴» on a day nobody weighed anything is an invented number, not a
 * cautious one.
 */
export function ExpensesPanel({
  day,
  expenses,
  shiftId,
  locale,
}: {
  day: CostOfDay;
  expenses: DayExpense[];
  shiftId: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const create = useCreateDayExpenseMutation();
  const update = useUpdateDayExpenseMutation();
  const remove = useDeleteDayExpenseMutation();

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftAmount, setDraftAmount] = useState('');

  // THE THREE NULLS TOGETHER, not `per_kg` alone. The server nulls all of
  // them on the same `isZero(reweighed_kg)` guard, so this is the same state —
  // but `formatDecimal` THROWS on a null, so a guard narrower than the values
  // it protects buys a thrown render instead of a dash. Naming all three both
  // narrows them for the `else` branch below (no casts) and makes the amber
  // panel the fallback if the response ever disagrees with itself.
  const { per_kg, shortfall_per_kg, expenses_per_kg } = day;
  const notSpread = per_kg === null || shortfall_per_kg === null || expenses_per_kg === null;

  async function add() {
    const trimmed = label.trim();
    if (!trimmed || !isAmount(amount)) return;
    try {
      await create.mutateAsync({ shiftId, label: trimmed, amount });
      setLabel('');
      setAmount('');
    } catch (error) {
      toast.error(t('costOfDay.expenses.addFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  function startEdit(line: DayExpense) {
    setEditing(line.id);
    setDraftLabel(line.label);
    setDraftAmount(line.amount);
  }

  async function saveEdit(line: DayExpense) {
    // ONLY what moved — see the component doc above.
    const patch: { id: string; label?: string; amount?: string } = { id: line.id };
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== line.label) patch.label = trimmed;
    if (isAmount(draftAmount) && draftAmount !== line.amount) patch.amount = draftAmount;

    if (patch.label === undefined && patch.amount === undefined) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch (error) {
      toast.error(t('costOfDay.expenses.updateFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  async function removeLine(line: DayExpense) {
    try {
      await remove.mutateAsync({ id: line.id });
    } catch (error) {
      toast.error(t('costOfDay.expenses.removeFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  return (
    <div className="flex h-fit flex-col gap-3 rounded-lg bg-muted/40 p-4 ring-1 ring-foreground/5">
      <Eyebrow>{t('costOfDay.expenses.title')}</Eyebrow>

      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('costOfDay.expenses.empty')}</p>
      ) : (
        expenses.map((line) =>
          editing === line.id ? (
            <div key={line.id} className="flex flex-wrap items-center gap-2">
              <TextInput
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                aria-label={t('costOfDay.expenses.labelField')}
                className="h-8 min-w-24 flex-1 text-xs"
              />
              <TextInput
                value={draftAmount}
                onChange={(e) => setDraftAmount(maskDecimalInput(e.target.value))}
                inputMode="decimal"
                aria-label={t('costOfDay.expenses.amountField')}
                className="h-8 w-24 text-right font-mono text-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveEdit(line)}
                disabled={!draftLabel.trim() || !isAmount(draftAmount) || update.isPending}
              >
                <Check className="size-3.5" />
                {t('costOfDay.expenses.save')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('costOfDay.expenses.cancel')}
                onClick={() => setEditing(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div key={line.id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
              <span className="font-mono text-sm tabular-nums">
                {formatUah(line.amount, locale)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide text-muted-foreground"
                aria-label={t('costOfDay.expenses.edit', { label: line.label })}
                onClick={() => startEdit(line)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide text-muted-foreground"
                aria-label={t('costOfDay.expenses.remove', { label: line.label })}
                onClick={() => void removeLine(line)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ),
        )
      )}

      <div className="print-hide flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('costOfDay.expenses.labelField')}
          aria-label={t('costOfDay.expenses.labelField')}
          className="h-8 min-w-28 flex-1 text-xs"
        />
        <TextInput
          value={amount}
          onChange={(e) => setAmount(maskDecimalInput(e.target.value))}
          inputMode="decimal"
          placeholder={t('costOfDay.expenses.amountField')}
          aria-label={t('costOfDay.expenses.amountField')}
          className="h-8 w-24 text-right font-mono text-xs"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void add()}
          disabled={!label.trim() || !isAmount(amount) || create.isPending}
        >
          <Plus className="size-3.5" />
          {t('costOfDay.expenses.add')}
        </Button>
      </div>

      {notSpread ? (
        <div className="rounded-lg bg-[var(--amber)]/10 px-3 py-2.5 text-[var(--amber)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{t('costOfDay.expenses.awaiting')}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {t('costOfDay.expenses.awaitingAmount', {
                amount: formatUah(day.expenses_amount, locale),
              })}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            {t('costOfDay.expenses.awaitingNote')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm">{t('costOfDay.expenses.shortfallRow')}</span>
            <span className="font-mono text-sm tabular-nums">
              {formatUah(day.shortfall_amount, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{t('costOfDay.expenses.expensesRow')}</span>
            <span className="font-mono text-sm tabular-nums">
              {formatUah(day.expenses_amount, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm font-semibold uppercase">
              {t('costOfDay.expenses.basket')}
            </span>
            <span className="font-mono text-base font-semibold tabular-nums">
              {formatUah(day.basket, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{t('costOfDay.expenses.perKg')}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {formatUah(per_kg, locale)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('costOfDay.expenses.split', {
              shortfall: formatUah(shortfall_per_kg, locale),
              expenses: formatUah(expenses_per_kg, locale),
            })}
          </p>
        </>
      )}
    </div>
  );
}
