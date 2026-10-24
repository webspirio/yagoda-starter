import { IsIn, IsOptional } from 'class-validator';
import { COST_SPLITS, type CostSplit } from '../cost-split';

/** `split` is optional — absent means `weight`, the screen's long-standing
 *  answer. An unknown value is a 400, never a silent fallback. */
export class CostOfDayQueryDto {
  @IsOptional()
  @IsIn(COST_SPLITS, { message: `split must be one of: ${COST_SPLITS.join(', ')}` })
  split?: CostSplit;
}
