import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListTareTypesQueryDto extends CatalogPaginationQueryDto {
  /** Deactivated tare types are hidden by default — they exist for history,
   *  since old receipts still snapshot their weight. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
