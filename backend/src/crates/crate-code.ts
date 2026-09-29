import { EntityManager } from 'typeorm';
import { nextDocumentCode, padSequence } from '../common/document-code';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/** Re-exported so the crates slice keeps one import for its numbering; the
 *  function itself lives in `common/document-code.ts`, where every kind's
 *  sequence is padded the same way. */
export { padSequence };

/**
 * The next code for an issuance at this shift, in this mode.
 *
 * ONE TABLE, TWO BOOKS. `CR` (розписка) and `CD` (завдаток) are separate kinds
 * so their day counters are separate: the paper log receives розписки only, and
 * a shared counter would riddle it with gaps that mean nothing. That is what
 * the `mode` scope below buys — every other coded table counts a whole shift.
 *
 * Everything else about the numbering — the advisory lock, the count that
 * includes voided rows, why the shift is the counter key — is
 * `nextDocumentCode`'s doc comment, and is no longer specific to crates.
 */
export async function nextIssuanceCode(
  manager: EntityManager,
  params: {
    pointCode: string;
    businessDate: string;
    shiftId: string;
    mode: CrateIssuanceMode;
  },
): Promise<string> {
  return nextDocumentCode(manager, {
    pointCode: params.pointCode,
    businessDate: params.businessDate,
    kind: params.mode === CrateIssuanceMode.Receipt ? 'CR' : 'CD',
    shiftId: params.shiftId,
    table: 'crate_issuances',
    scope: { column: 'mode', value: params.mode },
  });
}
