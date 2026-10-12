import { useTranslation } from 'react-i18next';
import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';
import { fitReceiptNote } from '../lib/fitReceiptNote';
import { Field } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';

/**
 * The network's note, in the paper's shape (7 × 40, monospace): a long line
 * breaks onto the next by itself, and a keystroke that would need an eighth
 * line is simply not taken.
 */
export function ReceiptNoteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const used = value === '' ? 0 : value.split('\n').length;

  return (
    <Field
      name="receipt_note"
      label={t('settings.receipt.label')}
      hint={`${t('settings.receipt.hint')} · ${t('settings.receipt.lines', { n: used, max: NOTE_LINES })}`}
    >
      {(a11y) => (
        <Textarea
          {...a11y}
          rows={NOTE_LINES}
          cols={NOTE_LINE_CHARS}
          wrap="off"
          // Lines break only where fitReceiptNote puts a \n, so the box needn't
          // match the paper's 13px — and below 16px iOS zooms on focus.
          className="font-mono"
          value={value}
          onChange={(e) => {
            const box = e.currentTarget;
            const fitted = fitReceiptNote(box.value);
            if (fitted === null) {
              // Refused: React restores `value`; put the caret back where it was.
              const caret = box.selectionStart - (box.value.length - value.length);
              requestAnimationFrame(() => box.setSelectionRange(caret, caret));
              return;
            }
            // Only breaks before the caret move it; the wrap runs left to right,
            // so fitting the text before the caret counts exactly those.
            const caret =
              fitReceiptNote(box.value.slice(0, box.selectionStart))?.length ?? box.selectionStart;
            onChange(fitted);
            requestAnimationFrame(() => box.setSelectionRange(caret, caret));
          }}
        />
      )}
    </Field>
  );
}
