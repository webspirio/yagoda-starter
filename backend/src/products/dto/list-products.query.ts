import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';

/**
 * No `include_inactive`: `products` has no `is_active` column at all —
 * visibility is derived from its grades (§4.1). No `q` search either; nothing
 * has asked for one and a bounded list does not need it.
 */
export class ListProductsQueryDto extends CatalogPaginationQueryDto {}
