import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListCollectionPointsQueryDto extends PaginationQueryDto {
  /** Deactivated points are hidden by default — they exist for history, not
   *  for picking from a list. */
  @IsOptional()
  @IsBooleanString()
  include_inactive?: string;
}
