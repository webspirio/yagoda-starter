import { BadRequestException } from '@nestjs/common';

/** The receipt's ruled lines — the frontend's `NOTE_LINES`/`NOTE_LINE_CHARS`. */
const RECEIPT_NOTE_LINES = 7;
const RECEIPT_NOTE_LINE_CHARS = 40;

/**
 * The editor wraps the note; this only checks the result fits the paper. A tab
 * prints eight columns wide and a `\r` is a line break the receipt would not
 * split on, so both are refused rather than clipped. Blank is stored as `null`.
 */
export function canonicalReceiptNote(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const lines = value.split('\n');
  if (
    /[\r\t]/.test(value) ||
    lines.length > RECEIPT_NOTE_LINES ||
    lines.some((line) => line.length > RECEIPT_NOTE_LINE_CHARS)
  ) {
    throw new BadRequestException({
      message: `receipt_note must fit ${RECEIPT_NOTE_LINES} lines of ${RECEIPT_NOTE_LINE_CHARS} characters`,
      code: 'RECEIPT_NOTE_TOO_LONG',
    });
  }
  return value;
}
