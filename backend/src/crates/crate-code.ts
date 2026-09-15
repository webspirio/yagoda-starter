import { EntityManager } from 'typeorm';
import { composeDocumentCode } from '../common/document-code';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * Pads to three digits and NEVER TRUNCATES. `lpad('1000', 3, '0')` in Postgres
 * is `'100'`, which collides with document 100; migration …0007 shipped that
 * bug once. `padStart` grows instead.
 */
export function padSequence(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * The next code for an issuance at this shift, in this mode.
 *
 * THE COUNT INCLUDES VOIDED ROWS. A number is burnt permanently when its
 * document is voided — §9.3 keeps the voided document in the journal «НАЗАВЖДИ
 * з печаткою», and reissuing its number would point two documents at one line
 * of the paper log.
 *
 * THE ADVISORY LOCK, not a retry loop. Two issuances in one (shift, mode) would
 * otherwise both read the same count and compose the same code; the loser gets
 * a 23505 on `UQ_crate_issuances_code` mid-transaction with a supplier waiting.
 * §2.2 («одна людина за раз») makes contention almost theoretical, which is
 * exactly why the cheap deterministic fix beats retry infrastructure this repo
 * does not have. It is an `xact` lock: it releases on commit or rollback with
 * nothing to clean up.
 *
 * THE SHIFT IS THE COUNTER KEY because `UQ_shifts_point_business_date` makes a
 * shift exactly one (point, day). No counters table exists or is needed.
 *
 * THIS DEPENDS ON ISSUANCES NEVER BEING HARD-DELETED. True today — there is no
 * DELETE route anywhere in this backend — and load-bearing tomorrow: a cleanup
 * script would silently restart the numbering.
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
  const kind = params.mode === CrateIssuanceMode.Receipt ? 'CR' : 'CD';

  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `crate-code:${params.shiftId}:${params.mode}`,
  ]);

  const rows: Array<{ n: string | number }> = await manager.query(
    `SELECT count(*)::int AS n FROM crate_issuances WHERE shift_id = $1 AND mode = $2`,
    [params.shiftId, params.mode],
  );
  const used = Number(rows[0]?.n ?? 0);

  return composeDocumentCode(
    params.pointCode,
    kind,
    params.businessDate,
    padSequence(used + 1),
  );
}
