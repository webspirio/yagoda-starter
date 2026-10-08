import { BadRequestException } from '@nestjs/common';
import { canonicalReceiptNote } from './receipt-note';

const line = (n: number, ch = 'x') => ch.repeat(n);
const lines = (count: number, width = 40) =>
  Array.from({ length: count }, () => line(width)).join('\n');

function refusal(value: string): unknown {
  try {
    canonicalReceiptNote(value);
  } catch (e) {
    return e instanceof BadRequestException ? e.getResponse() : e;
  }
  return null;
}

describe('canonicalReceiptNote', () => {
  it('stores blank as null', () => {
    expect(canonicalReceiptNote(null)).toBeNull();
    expect(canonicalReceiptNote('')).toBeNull();
    expect(canonicalReceiptNote('  \n  ')).toBeNull();
  });

  it('keeps a note that fits, exactly as sent', () => {
    expect(canonicalReceiptNote(lines(7))).toBe(lines(7));
    expect(canonicalReceiptNote('Ящики повертати до 20:00  ')).toBe('Ящики повертати до 20:00  ');
  });

  it('counts a Cyrillic letter as one character', () => {
    expect(canonicalReceiptNote(line(40, 'ї'))).toBe(line(40, 'ї'));
  });

  it.each([
    ['an eighth line', lines(8)],
    ['a 41st character', line(41)],
    ['a tab', 'Тел.\t067'],
    ['a carriage return', 'перший\r\nдругий'],
  ])('refuses %s with RECEIPT_NOTE_TOO_LONG', (_, value) => {
    expect(refusal(value)).toMatchObject({ code: 'RECEIPT_NOTE_TOO_LONG' });
  });
});
