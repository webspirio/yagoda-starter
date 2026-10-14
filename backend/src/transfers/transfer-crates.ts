import { TransferStatus } from './transfer-status.enum';
import type { Transfer } from './transfer.entity';

export type CountedTransfer = Pick<Transfer, 'status' | 'crates' | 'reported_crates' | 'resolved_crates' | 'resolved_at'>;

/** The crates ONE transfer adds to the point's empties — the TS twin of `transferCratesSql`'s
 *  CASE (void aside), used to size what voiding it takes away. Keep the two in step. */
export function countedCrates(t: CountedTransfer): number {
  if (t.status === TransferStatus.Accepted) return t.crates;
  if (t.status === TransferStatus.Disputed) return (t.resolved_at ? t.resolved_crates : t.reported_crates) ?? 0;
  return 0;
}
