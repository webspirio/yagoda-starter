import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatUah, isZero } from '@/shared/lib/money';
import { useCashCountsQuery, type CashCount } from '@/entities/cash-count';
import { CountResultView, type CountResultRow } from '@/features/count-shift';
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
 *
 * #178 — an open or a close counts both books, «Каса» and «Завдатки»: each gets
 * its own block and discrepancy, the title turns «з розбіжністю» when ANY book
 * is off, and the note is offered per book, «Каса» first.
 */
type Book = CashCount['book'];
const BOOKS: readonly Book[] = ['berry', 'crates'];

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
  // #178 — one count per book, «Каса» first: an open or a close writes both.
  const kind = result?.mode === 'open' ? 'opening' : 'closing';
  const rows =
    result === null || !fresh
      ? []
      : BOOKS.flatMap((book) => (counts.data?.data ?? []).filter((c) => c.book === book && c.kind === kind).slice(0, 1));

  // Latched, set during render: the LAST real content survives the fade-out
  // after `result` clears, instead of a hard pop or a blank flash (minor 14).
  const [view, setView] = useState<{ key: string; title: string; rows: CountResultRow[] } | null>(null);
  // Latched too: after a save the form keeps rendering while the dialog fades.
  const [noteTarget, setNoteTarget] = useState<CashCount | null>(null);
  // The books whose note form has been offered for this result. The form opens by
  // itself for the first book that takes a note and, after each save, for the next
  // one; after «Скасувати» the result's own buttons are the way back.
  const [noteOfferedFor, setNoteOfferedFor] = useState<ReadonlySet<Book>>(() => new Set());
  const [seen, setSeen] = useState(result);
  if (result !== null && result !== seen) {
    setSeen(result);
    setNoteOfferedFor(new Set());
    setNoteTarget(null);
    setFresh(false);
  }
  if (result !== null && !fresh && !counts.isFetching) setFresh(true);

  const offerNote = (row: CashCount) => {
    setNoteOfferedFor((offered) => new Set(offered).add(row.book));
    setNoteTarget(row);
  };
  const nextToOffer = rows.find((row) => row.operator_note_editable && !noteOfferedFor.has(row.book)) ?? null;
  if (noteOfferedFor.size === 0 && nextToOffer !== null) offerNote(nextToOffer);

  if (result !== null && rows.length > 0) {
    const off = rows.find((row) => !isZero(row.discrepancy)) ?? null;
    const amount = off === null ? '' : formatUah(off.discrepancy, i18n.language);
    const title =
      result.mode === 'open'
        ? off === null
          ? t('pointCash.result.opened')
          : t('pointCash.result.openedDiscrepancy', { amount })
        : off === null
          ? t('pointCash.result.closedSettled')
          : t('pointCash.result.closedDiscrepancy', { amount });
    const viewRows = rows.map((row) => ({
      label: t(`countResult.book.${row.book}`),
      counted: row.counted_amount,
      expected: row.expected_amount,
      discrepancy: row.discrepancy,
    }));
    const key = JSON.stringify([title, viewRows]);
    if (view === null || view.key !== key) setView({ key, title, rows: viewRows });
  }

  const editable = rows.filter((row) => row.operator_note_editable);

  return (
    <CountResultView
      open={result !== null && rows.length > 0}
      title={view?.title ?? ''}
      counted={view?.rows[0]?.counted ?? '0.00'}
      rows={view?.rows ?? []}
      onClose={onClose}
      action={editable.map((row) => (
        <Button key={row.book} type="button" variant="outline" onClick={() => offerNote(row)}>
          {editable.length > 1
            ? `${t('operatorNote.resultAction')} · ${t(`countResult.book.${row.book}`)}`
            : t('operatorNote.resultAction')}
        </Button>
      ))}
      swap={
        noteTarget ? (
          <OperatorNoteForm
            key={noteTarget.id}
            count={noteTarget}
            onDone={() => (nextToOffer !== null ? offerNote(nextToOffer) : onClose())}
            onCancel={() => setNoteTarget(null)}
          />
        ) : null
      }
    />
  );
}
