import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { inTransitCratesSql, onHandSql } from '../crates/crate-balance.service';

/**
 * «Пустих на точці» never goes below zero through a new document (spec 2026-09-30).
 *
 * Called LAST in the transaction of each write that TAKES empties (issue, breakage, a receipt's
 * crate tare, voiding a transfer or a return, resolving a dispute downwards) — never by one that
 * gives them back, so a point already negative can still be healed. The point row lock is taken
 * after the caller's own row and document-code locks; the one lock that can follow it is a receipt's
 * payout code (PO advisory), which is safe because nothing takes that lock and then the point row.
 * Under READ COMMITTED the recount below sees any write that committed while we waited — two
 * issuances that each fit alone cannot both pass.
 *
 * FOR NO KEY UPDATE, not FOR UPDATE: it still serialises guard against guard, but does not
 * conflict with the FOR KEY SHARE an insert into shifts/transfers/suppliers/... takes on its
 * collection_point_id foreign key, so those inserts never queue behind a crates write.
 */
@Injectable()
export class CrateStockGuard {
  async assertOnHand(m: EntityManager, pointId: string, required: number): Promise<void> {
    await m.query('SELECT id FROM collection_points WHERE id = $1 FOR NO KEY UPDATE', [pointId]);
    const [row] = (await m.query(
      `SELECT ${onHandSql('$1')} AS after, ${inTransitCratesSql('$1')} AS in_transit`,
      [pointId],
    )) as Array<{ after: number; in_transit: number }>;
    if (row.after >= 0) return;
    const available = row.after + required;
    throw new ConflictException({
      message: `The point has ${available} empty crates, this takes ${required}`,
      code: 'CRATES_ON_HAND_INSUFFICIENT',
      available,
      required,
      in_transit: row.in_transit,
    });
  }
}
