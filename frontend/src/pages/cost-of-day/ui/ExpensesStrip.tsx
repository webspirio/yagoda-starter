import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableRow } from '@/shared/ui/table';
import { TextInput } from '@/shared/ui/text-input';
import { DecimalInput } from '@/shared/ui/decimal-input';
import { useDecimalField } from '@/shared/ui/use-decimal-field';
import { toast } from '@/shared/ui/toast';
import { cmp, formatDecimal, formatUah, toDecimalField } from '@/shared/lib/money';
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

/** A parsed amount the server would accept: above zero (`amountPositive`). */
const positive = (parsed: string | null): parsed is string =>
  parsed !== null && cmp(parsed, '0.00') > 0;

/** Enter in a field of the row presses that row's button (audit E11). */
const onEnter = (run: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault();
    run();
  }
};

/** `Field`'s error line, for the two amount inputs that sit outside a `Field`. */
function FormatError({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <p id={id} role="alert" className="mt-1.5 basis-full text-xs leading-snug text-destructive">
      {t('errors.decimalFormat')}
    </p>
  );
}

/**
 * §8.3's «Витрати дня» as a small table above the cost table — «Права (ВИТРАТИ) — єдине
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
  // The line whose «Прибрати» was pressed and awaits a yes — a stray click on
  // the trash can no longer takes money out of the day (audit E11).
  const [removing, setRemoving] = useState<string | null>(null);
  // #72 — parse, the shared message (once the field is left) and the aria
  // wiring: these inputs sit outside a `Field`, so the hook carries it.
  const addAmount = useDecimalField(amount, { errorId: 'expense-amount-error' });
  const editAmount = useDecimalField(draftAmount, { errorId: 'expense-edit-amount-error' });

  async function add() {
    const trimmed = label.trim();
    const canonical = addAmount.parsed;
    if (!trimmed || !positive(canonical) || create.isPending) return;
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
    // The way the screen prints it («1000,00» in uk); `editAmount.parsed` reads
    // it back canonical, so an untouched amount still compares equal below.
    setDraftAmount(toDecimalField(line.amount, locale));
  }

  async function saveEdit(line: DayExpense) {
    // ONLY what moved — see the component doc above.
    const patch: { id: string; label?: string; amount?: string } = { id: line.id };
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== line.label) patch.label = trimmed;
    const canonical = editAmount.parsed;
    if (!trimmed || !positive(canonical) || update.isPending) return;
    if (canonical !== line.amount) patch.amount = canonical;

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
    setRemoving(null);
    try {
      await remove.mutateAsync({ id: line.id });
    } catch (error) {
      toast.error(t('costOfDay.expenses.removeFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  // A table, not a strip of pills: the lines read as a column of amounts the
  // way the cost table below reads its own, and the add form is simply the
  // last row — so a long day's list grows downwards instead of wrapping into
  // the total.
  const amountCell = 'w-36 text-right';
  const actionsCell = 'w-40 text-right';

  return (
    <div className="max-w-2xl overflow-hidden rounded-lg ring-1 ring-[var(--plum)]/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 pt-3 pb-2">
        <Eyebrow className="text-[var(--plum)]">{t('costOfDay.expenses.title')}</Eyebrow>
        <span className="font-mono text-sm font-semibold tabular-nums text-[var(--plum)]">
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

      <Table className="[&_td]:px-3 [&_td]:py-1.5">
        <TableBody>
          {expenses.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-sm text-muted-foreground">
                {t('costOfDay.expenses.empty')}
              </TableCell>
            </TableRow>
          ) : (
            expenses.map((line) =>
              editing === line.id ? (
                <TableRow key={line.id}>
                  <TableCell>
                    <TextInput
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={onEnter(() => void saveEdit(line))}
                      aria-label={t('costOfDay.expenses.labelField')}
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className={amountCell}>
                    <DecimalInput
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      onKeyDown={onEnter(() => void saveEdit(line))}
                      {...editAmount.inputProps}
                      aria-label={t('costOfDay.expenses.amountField')}
                      className="h-8 text-right font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell className={actionsCell}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void saveEdit(line)}
                        disabled={
                          !draftLabel.trim() || !positive(editAmount.parsed) || update.isPending
                        }
                      >
                        <Check className="size-3.5" />
                        {t('costOfDay.expenses.save')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('costOfDay.expenses.cancel')}
                        onClick={() => setEditing(null)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                    {editAmount.error ? <FormatError id="expense-edit-amount-error" /> : null}
                  </TableCell>
                </TableRow>
              ) : removing === line.id ? (
                <TableRow key={line.id} className="bg-destructive/8 hover:bg-destructive/8">
                  <TableCell colSpan={2} className="text-sm">
                    {t('costOfDay.expenses.removeConfirm', { label: line.label })}
                  </TableCell>
                  <TableCell className={actionsCell}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        autoFocus
                        disabled={remove.isPending}
                        onClick={() => void removeLine(line)}
                      >
                        {t('costOfDay.expenses.removeYes')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                        {t('costOfDay.expenses.cancel')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={line.id}>
                  <TableCell className="text-sm">{line.label}</TableCell>
                  <TableCell
                    className={`${amountCell} font-mono text-sm tabular-nums text-[var(--plum)]`}
                  >
                    {formatUah(line.amount, locale)}
                  </TableCell>
                  <TableCell className={actionsCell}>
                    <div className="print-hide flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                        aria-label={t('costOfDay.expenses.edit', { label: line.label })}
                        onClick={() => startEdit(line)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                        aria-label={t('costOfDay.expenses.remove', { label: line.label })}
                        onClick={() => setRemoving(line.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )
          )}

          <TableRow className="print-hide hover:bg-transparent">
            <TableCell>
              <TextInput
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={onEnter(() => void add())}
                placeholder={t('costOfDay.expenses.labelField')}
                aria-label={t('costOfDay.expenses.labelField')}
                className="h-8 text-xs"
              />
            </TableCell>
            <TableCell className={amountCell}>
              <DecimalInput
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={onEnter(() => void add())}
                {...addAmount.inputProps}
                placeholder={formatDecimal('0.00', locale)}
                aria-label={t('costOfDay.expenses.amountField')}
                className="h-8 text-right font-mono text-xs"
              />
              {addAmount.error ? <FormatError id="expense-amount-error" /> : null}
            </TableCell>
            <TableCell className={actionsCell}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void add()}
                disabled={!label.trim() || !positive(addAmount.parsed) || create.isPending}
              >
                <Plus className="size-3.5" />
                {t('costOfDay.expenses.addLine')}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
