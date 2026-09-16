import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { nextIssuanceCode, padSequence } from './crate-code';

describe('padSequence', () => {
  it('pads to three digits', () => {
    expect(padSequence(1)).toBe('001');
    expect(padSequence(42)).toBe('042');
    expect(padSequence(999)).toBe('999');
  });

  /**
   * THE `lpad` TRAP, in JavaScript form. Migration …0007 shipped a truncating
   * pad once already: document 1000 rendered as '100' and collided with
   * document 100. `padStart` does not truncate — this test is what keeps
   * anyone from "fixing" it into something that does.
   */
  it('does not truncate past three digits', () => {
    expect(padSequence(1000)).toBe('1000');
    expect(padSequence(12345)).toBe('12345');
  });
});

describe('nextIssuanceCode', () => {
  const managerWithCount = (n: number) => ({
    query: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
      return Promise.resolve([{ n }]);
    }),
  });

  it('numbers receipts and deposits on separate counters', async () => {
    const manager = managerWithCount(6);
    const code = await nextIssuanceCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Receipt,
    });
    expect(code).toBe('SHP-CR-20260915-007');
  });

  it('uses the CD kind for a deposit issuance', async () => {
    const manager = managerWithCount(13);
    const code = await nextIssuanceCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    expect(code).toBe('SHP-CD-20260915-014');
  });

  it('takes the advisory lock before counting', async () => {
    const manager = managerWithCount(0);
    await nextIssuanceCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    const [first] = manager.query.mock.calls[0] as [string];
    expect(first).toContain('pg_advisory_xact_lock');
  });

  it('counts voided rows too, so a number is never reissued', async () => {
    const manager = managerWithCount(3);
    await nextIssuanceCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
      sql.includes('count(*)'),
    );
    expect(counting?.[0]).not.toContain('voided_at');
  });
});
