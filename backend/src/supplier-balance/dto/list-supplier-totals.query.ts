import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const SUPPLIER_TOTALS_SORTS = ['weight', 'amount', 'name'] as const;
export type SupplierTotalsSort = (typeof SUPPLIER_TOTALS_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

/**
 * §11.4's «топ здавальників». Active suppliers only — the page has no Стан
 * column to show an inactive one with. `order` has no DTO default because the
 * natural direction depends on the key (heaviest first, names A→Z); the query
 * resolves it. `collection_point_id` is IGNORED for an operator, as on
 * `/suppliers`.
 */
export class ListSupplierTotalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @IsOptional()
  @IsIn(SUPPLIER_TOTALS_SORTS)
  sort: SupplierTotalsSort = 'weight';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;
}
