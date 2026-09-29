import { BadRequestException } from '@nestjs/common';
import { composeDocumentCode, nextDocumentCode, normalizeTypedCode } from './document-code';

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

describe('nextDocumentCode', () => {
  const managerWithCount = (n: number) => ({
    query: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
      return Promise.resolve([{ n }]);
    }),
  });

  it('numbers an intake from the count of that shift', async () => {
    const manager = managerWithCount(6);
    const code = await nextDocumentCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-18',
      kind: 'IN',
      shiftId: 'a-shift',
      table: 'intakes',
    });
    expect(code).toBe('SHP-IN-20260918-007');
  });

  it('numbers a payout on its own counter, in the same shift', async () => {
    const manager = managerWithCount(2);
    const code = await nextDocumentCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-18',
      kind: 'PO',
      shiftId: 'a-shift',
      table: 'payouts',
    });
    expect(code).toBe('SHP-PO-20260918-003');
  });

  it('counts the table it was asked for', async () => {
    const manager = managerWithCount(0);
    await nextDocumentCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-18',
      kind: 'PO',
      shiftId: 'a-shift',
      table: 'payouts',
    });
    const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
      sql.includes('count(*)'),
    );
    expect(counting?.[0]).toContain('FROM payouts');
  });

  it('takes the advisory lock before counting', async () => {
    const manager = managerWithCount(0);
    await nextDocumentCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-18',
      kind: 'IN',
      shiftId: 'a-shift',
      table: 'intakes',
    });
    const [first] = manager.query.mock.calls[0] as [string];
    expect(first).toContain('pg_advisory_xact_lock');
  });

  it('partitions the lock by kind, so an intake never waits on a payout', async () => {
    const lockKeyFor = async (kind: 'IN' | 'PO') => {
      const manager = managerWithCount(0);
      await nextDocumentCode(manager as never, {
        pointCode: 'KON',
        businessDate: '2026-09-18',
        kind,
        shiftId: 'a-shift',
        table: kind === 'IN' ? 'intakes' : 'payouts',
      });
      const [, params] = manager.query.mock.calls[0] as [string, string[]];
      return params[0];
    };
    expect(await lockKeyFor('IN')).not.toBe(await lockKeyFor('PO'));
  });

  it('counts voided rows too, so a number is never reissued', async () => {
    const manager = managerWithCount(3);
    await nextDocumentCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-18',
      kind: 'IN',
      shiftId: 'a-shift',
      table: 'intakes',
    });
    const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
      sql.includes('count(*)'),
    );
    expect(counting?.[0]).not.toContain('voided_at');
  });

  it('narrows the counter with a scope, so crate books stay separate', async () => {
    const manager = managerWithCount(6);
    const code = await nextDocumentCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-18',
      kind: 'CR',
      shiftId: 'a-shift',
      table: 'crate_issuances',
      scope: { column: 'mode', value: 'receipt' },
    });
    expect(code).toBe('SHP-CR-20260918-007');
    const counting = (manager.query.mock.calls as [string, string[]][]).find(([sql]) =>
      sql.includes('count(*)'),
    );
    expect(counting?.[0]).toContain('mode = $2');
    expect(counting?.[1]).toEqual(['a-shift', 'receipt']);
  });
});
