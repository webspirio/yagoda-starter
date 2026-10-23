import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TextInput } from '@/shared/ui/text-input';
import { DecimalInput } from '@/shared/ui/decimal-input';
import { useDecimalField } from '@/shared/ui/use-decimal-field';
import { toast } from '@/shared/ui/toast';
import { formatDecimal, formatUah } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import {
  useCreateDayExpenseMutation,
  useDeleteDayExpenseMutation,
  useUpdateDayExpenseMutation,
  type DayExpense,
} from '@/entities/day-expense';
import type { CostOfDay } from '@/entities/cost-of-day';

// Why the amount inputs gate on the grammar, not the mask (#72):
// `DecimalInput`'s mask is a TYPING mask, not a validator: '.' and '12.' both
// survive it mid-keystroke, and `CreateDayExpenseDto`'s
// `@Matches(/^\d{1,10}(\.\d{1,2})?$/)` refuses both — as a 400 that reaches
// the person as «щось пішло не так», which says nothing about which field was
// wrong. Gate on THE grammar, `parseDecimal` (#72), so the refusal is a
// disabled button plus the shared `errors.decimalFormat` line under the field.
// (The grammar stops two digits SHORT of the DTO on purpose — `input.ts` says
// why: 99 999 999,99 ₴ of пальне is a missed key, not a day.) What is sent is
// `parseDecimal`'s canonical output (`useDecimalField`'s `parsed`), never the
// raw text.

/** `Field`'s error line, for the two amount inputs that sit outside a `Field`. */
function FormatError({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <p id={id} role="alert" className="mt-1.5 w-full text-xs leading-snug text-destructive">
      {t('errors.decimalFormat')}
    </p>
  );
}

/**
 * §8.3's «Витрати дня» as a strip above the table — «Права (ВИТРАТИ) — єдине
 * місце вводу». Everything writable on this screen is in this component; the
 * basket, the rate and the недостача are read in the table now.
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
 */
export function ExpensesStrip({
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
  // #72 — parse, the shared message (once the field is left) and the aria
  // wiring: these inputs sit outside a `Field`, so the hook carries it.
  const addAmount = useDecimalField(amount, { errorId: 'expense-amount-error' });
  const editAmount = useDecimalField(draftAmount, { errorId: 'expense-edit-amount-error' });

  async function add() {
    const trimmed = label.trim();
    const canonical = addAmount.parsed;
    if (!trimmed || canonical === null) return;
    try {
      await create.mutateAsync({ shiftId, label: trimmed, amount: canonical });
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
    const canonical = editAmount.parsed;
    if (canonical !== null && canonical !== line.amount) patch.amount = canonical;

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-3 ring-1 ring-[var(--plum)]/40">
      <Eyebrow className="text-[var(--plum)]">{t('costOfDay.expenses.title')}</Eyebrow>

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
                className="h-8 min-w-24 text-xs"
              />
              <DecimalInput
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
                {...editAmount.inputProps}
                aria-label={t('costOfDay.expenses.amountField')}
                className="h-8 w-24 text-right font-mono text-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveEdit(line)}
                disabled={!draftLabel.trim() || editAmount.parsed === null || update.isPending}
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
              {editAmount.error ? <FormatError id="expense-edit-amount-error" /> : null}
            </div>
          ) : (
            <div
              key={line.id}
              className="flex items-center gap-1 rounded-full bg-muted/50 py-0.5 pl-3 pr-1"
            >
              <span className="text-sm">{line.label}</span>
              <span className="font-mono text-sm tabular-nums text-[var(--plum)]">
                {formatUah(line.amount, locale)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide size-6 text-muted-foreground"
                aria-label={t('costOfDay.expenses.edit', { label: line.label })}
                onClick={() => startEdit(line)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide size-6 text-muted-foreground"
                aria-label={t('costOfDay.expenses.remove', { label: line.label })}
                onClick={() => void removeLine(line)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ),
        )
      )}

      <div className="print-hide flex flex-wrap items-center gap-2">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('costOfDay.expenses.labelField')}
          aria-label={t('costOfDay.expenses.labelField')}
          className="h-8 min-w-28 text-xs"
        />
        <DecimalInput
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          {...addAmount.inputProps}
          placeholder={t('costOfDay.expenses.amountField')}
          aria-label={t('costOfDay.expenses.amountField')}
          className="h-8 w-24 text-right font-mono text-xs"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void add()}
          disabled={!label.trim() || addAmount.parsed === null || create.isPending}
        >
          <Plus className="size-3.5" />
          {t('costOfDay.expenses.addLine')}
        </Button>
        {addAmount.error ? <FormatError id="expense-amount-error" /> : null}
      </div>

      <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-[var(--plum)]">
        {day.expenses_per_kg === null
          ? t('costOfDay.expenses.totalNoRate', {
              amount: formatUah(day.expenses_amount, locale),
            })
          : t('costOfDay.expenses.total', {
              amount: formatUah(day.expenses_amount, locale),
              perKg: formatDecimal(day.expenses_per_kg, locale),
            })}
      </span>
    </div>
  );
}
