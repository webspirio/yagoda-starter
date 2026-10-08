import { describe, expect, it } from 'vitest';
import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';
import { fitReceiptNote } from './fitReceiptNote';

const x = (n: number) => 'x'.repeat(n);

describe('fitReceiptNote', () => {
  it('leaves text that already fits untouched', () => {
    expect(fitReceiptNote('two\nlines')).toBe('two\nlines');
    expect(fitReceiptNote('')).toBe('');
  });

  it('breaks a long line at its last space', () => {
    expect(fitReceiptNote(`${x(30)} ${x(15)}`)).toBe(`${x(30)}\n${x(15)}`);
  });

  it('breaks at a space sitting exactly on the limit', () => {
    expect(fitReceiptNote(`${x(NOTE_LINE_CHARS)} y`)).toBe(`${x(NOTE_LINE_CHARS)}\ny`);
  });

  it('cuts a word longer than the line at the limit', () => {
    expect(fitReceiptNote(x(NOTE_LINE_CHARS + 5))).toBe(`${x(NOTE_LINE_CHARS)}\n${x(5)}`);
  });

  it('refuses anything past the last ruled line', () => {
    const full = Array.from({ length: NOTE_LINES }, () => x(NOTE_LINE_CHARS)).join('\n');
    expect(fitReceiptNote(full)).toBe(full);
    expect(fitReceiptNote(`${full}\n`)).toBeNull();
    expect(fitReceiptNote(`${full}y`)).toBeNull();
  });
});
