import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatUah, isZero } from '@/shared/lib/money';
import { useCashCountsQuery, type CashCount } from '@/entities/cash-count';
import { CountResultView } from '@/features/count-shift';
import { OperatorNoteForm } from '@/features/set-operator-note';

export type ShiftCountResultFor = { mode: 'open' | 'close'; shiftId: string };

/**
 * The result after an open or close — its discrepancy and, when the counter may
 * explain it, the note form opened once (spec 2026-10-08). A widget because the
 * banner close on «Прийомка» and «Каса за день» needs the same screen as «Каса
 * точки», and `count-shift` may not import `set-operator-note`.
 *
 * Read back from the counts of `result.shiftId`, not from the mutation's
 * response: the mutations' `onSuccess` refetches the counts, and that refetch is
 * what this waits for. A NEW `result` object starts a new offer of the form.
 */
export function ShiftCountResult({
  result,
  onClose,
}: {
  result: ShiftCountResultFor | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const counts = useCashCountsQuery({ shiftId: result?.shiftId });
  // Nothing until the refetch the close started has landed: a cached closing
  // count may be one a remote reopen already demoted.
  const [fresh, setFresh] = useState(false);
  const row =
    result === null || !fresh
      ? null
      : ((counts.data?.data ?? []).find(
          (c) => c.book === 'berry' && c.kind === (result.mode === 'open' ? 'opening' : 'closing'),
        ) ?? null);

  // Latched, set during render: the LAST real content survives the fade-out
  // after `result` clears, instead of a hard pop or a blank flash (minor 14).
  const [view, setView] = useState<{ title: string; counted: string; discrepancy: string } | null>(null);
  // Latched too: after a save the form keeps rendering while the dialog fades.
  const [noteTarget, setNoteTarget] = useState<CashCount | null>(null);
  // The form opens by itself once per result; after «Скасувати» the result's own button is the way back.
  const [noteOffered, setNoteOffered] = useState(false);
  const [seen, setSeen] = useState(result);
  if (result !== null && result !== seen) {
    setSeen(result);
    setNoteOffered(false);
    setNoteTarget(null);
    setFresh(false);
  }
  if (result !== null && !fresh && !counts.isFetching) setFresh(true);
  if (row?.operator_note_editable && !noteOffered) {
    setNoteOffered(true);
    setNoteTarget(row);
  }
  if (result !== null && row !== null) {
    const amount = formatUah(row.discrepancy, i18n.language);
    const title =
      result.mode === 'open'
        ? isZero(row.discrepancy)
          ? t('pointCash.result.opened')
          : t('pointCash.result.openedDiscrepancy', { amount })
        : isZero(row.discrepancy)
          ? t('pointCash.result.closedSettled')
          : t('pointCash.result.closedDiscrepancy', { amount });
    if (view === null || view.title !== title || view.counted !== row.counted_amount || view.discrepancy !== row.discrepancy) {
      setView({ title, counted: row.counted_amount, discrepancy: row.discrepancy });
    }
  }

  return (
    <CountResultView
      open={result !== null && row !== null}
      title={view?.title ?? ''}
      counted={view?.counted ?? '0.00'}
      discrepancy={view?.discrepancy ?? null}
      onClose={onClose}
      action={
        row?.operator_note_editable ? (
          <Button type="button" variant="outline" onClick={() => setNoteTarget(row)}>
            {t('operatorNote.resultAction')}
          </Button>
        ) : null
      }
      swap={
        noteTarget ? (
          <OperatorNoteForm count={noteTarget} onDone={onClose} onCancel={() => setNoteTarget(null)} />
        ) : null
      }
    />
  );
}
