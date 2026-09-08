import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * The JOURNAL read — every row, newest first, for an owner auditing a price
 * move. `PaginationQueryDto` (default 20): this list is unbounded and grows
 * forever, so it is browsable, not a picker.
 *
 * NO `include_inactive`. The journal is history, and history is not filtered
 * by the current state of the thing it describes.
 */
export class ListGradePricesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  product_grade_id?: string;
}
