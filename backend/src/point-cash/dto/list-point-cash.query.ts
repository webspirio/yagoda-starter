import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPointCashQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  /** Defaults to today. The formula is date-granular; see the service header. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'as_of must be YYYY-MM-DD' })
  as_of?: string;
}
