import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListCashCountsQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  /** Inclusive bounds on the shift's business date. */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** The owner's working list: counts that disagree AND have no explanation. */
  @BooleanQueryParam()
  only_discrepancies: boolean = false;
}
