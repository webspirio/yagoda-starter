import { countedCrates } from './transfer-crates';
import { TransferStatus } from './transfer-status.enum';

const t = (over: Partial<Parameters<typeof countedCrates>[0]>) => ({
  status: TransferStatus.Sent, crates: 20, reported_crates: null, resolved_crates: null, resolved_at: null, ...over,
});

describe('countedCrates — what transferCratesSql counts for one transfer', () => {
  it('sent counts nothing', () => expect(countedCrates(t({}))).toBe(0));
  it('accepted counts what was sent', () => expect(countedCrates(t({ status: TransferStatus.Accepted }))).toBe(20));
  it('disputed and open counts what the point reported', () =>
    expect(countedCrates(t({ status: TransferStatus.Disputed, reported_crates: 18 }))).toBe(18));
  it('disputed and resolved counts the resolution', () =>
    expect(countedCrates(t({ status: TransferStatus.Disputed, reported_crates: 18, resolved_crates: 5, resolved_at: new Date() }))).toBe(5));
});
