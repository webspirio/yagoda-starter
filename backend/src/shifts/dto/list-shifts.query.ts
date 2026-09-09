import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ShiftStatus } from '../shift-status.enum';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListShiftsQueryDto extends PaginationQueryDto {
  /** Ignored for an operator — `resolvePointFilter` pins them to their own
   *  point rather than rejecting the parameter. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsEnum(ShiftStatus)
  status?: ShiftStatus;

  /** Inclusive bounds on `business_date`, as 'YYYY-MM-DD'. Compared as a `date`
   *  in Postgres, so no timezone enters the query. */
  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
