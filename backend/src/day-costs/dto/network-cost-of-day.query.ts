import { IsIn, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { COST_SPLITS, type CostSplit } from '../cost-split';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `date` is required — a network day answers one specific business date, never "all
 *  time" or "today by default"; the caller states which day. Same pattern
 *  as `ListShiftsQueryDto`'s `from`/`to`, compared as a `date` in Postgres
 *  so no timezone enters the query. */
export class NetworkCostOfDayQueryDto {
  @IsNotEmpty({ message: 'date is required' })
  @Matches(BUSINESS_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  /** Spec 2026-10-24 §3.4 — the same split as the single-point page, passed
   *  to every point's own day. Absent means `weight`. */
  @IsOptional()
  @IsIn(COST_SPLITS, { message: `split must be one of: ${COST_SPLITS.join(', ')}` })
  split?: CostSplit;
}
