import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * No money, no allocations, no `shift_id`. WHICH issuances are repaid is the
 * server's FIFO answer — §6.5: the operator «нічого не питає і не обирає».
 */
export class CreateCrateReturnDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  units: number;
}
