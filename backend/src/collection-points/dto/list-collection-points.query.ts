import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListCollectionPointsQueryDto extends PaginationQueryDto {
  /** Deactivated points are hidden by default — they exist for history, not
   *  for picking from a list. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
