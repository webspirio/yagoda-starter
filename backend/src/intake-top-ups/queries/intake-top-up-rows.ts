import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from '../intake-top-up.mapper';
import { Intake } from '../../intakes/intake.entity';

/** Aliased columns: a raw query is the only way to bring the parent's `code` and `voided_at` back in one trip. */
export interface RawTopUpRow {
  t_id: string;
  t_intake_id: string;
  t_amount: string;
  t_reason: string;
  t_created_by_user_id: string;
  t_created_at: Date;
  t_updated_at: Date;
  t_voided_at: Date | null;
  t_voided_by_user_id: string | null;
  t_void_reason: string | null;
  i_code: string;
  i_voided_at: Date | null;
}

/** The join every read shares, so the scope rule is written once. The point is two hops away
 *  (top-up → intake → supplier, §3.9) — do not denormalise it onto this table. */
export function topUpRows(repo: Repository<IntakeTopUp>, pointId?: string) {
  const qb = repo
    .createQueryBuilder('t')
    .innerJoin(Intake, 'i', 'i.id = t.intake_id')
    .innerJoin('suppliers', 's', 's.id = i.supplier_id')
    .select([
      't.id AS t_id',
      't.intake_id AS t_intake_id',
      't.amount AS t_amount',
      't.reason AS t_reason',
      't.created_by_user_id AS t_created_by_user_id',
      't.created_at AS t_created_at',
      't.updated_at AS t_updated_at',
      't.voided_at AS t_voided_at',
      't.voided_by_user_id AS t_voided_by_user_id',
      't.void_reason AS t_void_reason',
      'i.code AS i_code',
      'i.voided_at AS i_voided_at',
    ]);
  if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
  return qb;
}

export function toTopUpResponse(row: RawTopUpRow): IntakeTopUpResponse {
  return toIntakeTopUpResponse(
    {
      id: row.t_id,
      intake_id: row.t_intake_id,
      amount: row.t_amount,
      reason: row.t_reason,
      created_by_user_id: row.t_created_by_user_id,
      created_at: row.t_created_at,
      updated_at: row.t_updated_at,
      voided_at: row.t_voided_at,
      voided_by_user_id: row.t_voided_by_user_id,
      void_reason: row.t_void_reason,
    } as IntakeTopUp,
    { id: row.t_intake_id, code: row.i_code, voided_at: row.i_voided_at },
  );
}
