import { BadRequestException } from '@nestjs/common';
import { composeDocumentCode, normalizeTypedCode } from './document-code';

describe('normalizeTypedCode', () => {
  it.each([
    ['04412', '04412'],
    ['  04412  ', '04412'],
    ['a-17', 'A-17'],
    ['A17', 'A17'],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeTypedCode(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['-17'], // must start alphanumeric
    ['04 412'], // no spaces inside
    ['04/412'],
    ['ПРИЙОМ12'], // Cyrillic would defeat the CHECK on the composed code
    ['A'.repeat(17)],
  ])('rejects %p', (raw) => {
    expect(() => normalizeTypedCode(raw)).toThrow(BadRequestException);
  });
});

describe('composeDocumentCode', () => {
  it('composes point, kind, business date and typed number', () => {
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', '04412')).toBe('KPG-IN-20260908-04412');
    expect(composeDocumentCode('KPG', 'PO', '2026-09-08', '31')).toBe('KPG-PO-20260908-31');
  });

  it('uses the SHIFT business date, not the wall clock', () => {
    // A shift opened on the 8th and still open at 00:10 on the 9th writes the
    // 8th. Passing the date in rather than reading a clock is what guarantees
    // this, so the signature is the test.
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', '1')).toContain('20260908');
  });

  it('normalizes the typed part on the way through', () => {
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', ' a-17 ')).toBe('KPG-IN-20260908-A-17');
  });

  it('rejects a business date that is not YYYY-MM-DD', () => {
    expect(() => composeDocumentCode('KPG', 'IN', '08.09.2026', '1')).toThrow(BadRequestException);
  });
});
