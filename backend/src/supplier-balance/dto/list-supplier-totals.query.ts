import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const SUPPLIER_TOTALS_SORTS = ['weight', 'amount', 'name'] as const;
export type SupplierTotalsSort = (typeof SUPPLIER_TOTALS_SORTS)[number];
const SUPPLIER_TOTALS_STATUSES = ['active', 'inactive', 'all'] as const;
export type SupplierTotalsStatus = (typeof SUPPLIER_TOTALS_STATUSES)[number];
export type SortOrder = 'asc' | 'desc';

/**
 * §11.4's «топ здавальників». `status` picks the suppliers (active by
 * default; the row carries `is_active` for the mixed `all`). `order` has no DTO default because the
 * natural direction depends on the key (heaviest first, names A→Z); the query
 * resolves it. `collection_point_id` is IGNORED for an operator, as on
 * `/suppliers`. No `page`/`limit`: the list is unpaged (see the query).
 */
export class ListSupplierTotalsQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @IsOptional()
  @IsIn(SUPPLIER_TOTALS_STATUSES)
  status: SupplierTotalsStatus = 'active';

  @IsOptional()
  @IsIn(SUPPLIER_TOTALS_SORTS)
  sort: SupplierTotalsSort = 'weight';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;
}
