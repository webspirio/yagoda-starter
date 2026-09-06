import { IsOptional, IsUUID } from 'class-validator';
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListProductGradesQueryDto extends CatalogPaginationQueryDto {
  /** The filter the owner UI's product→grades tree actually needs. */
  @IsOptional()
  @IsUUID()
  product_id?: string;

  /** Deactivated grades are hidden by default — they exist for history. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
