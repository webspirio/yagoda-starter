import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * `PaginationQueryDto` (default 20), NOT `CatalogPaginationQueryDto` (100).
 * Products and tare types are bounded reference tables read into a picker;
 * suppliers is UNBOUNDED and grows forever — a busy point accumulates hundreds
 * and there is no delete. This is a browsable list, so the browsable default
 * is the right one.
 *
 * `collection_point_id` is IGNORED for an operator rather than rejected — see
 * `resolvePointFilter`'s doc comment: the parameter can neither widen nor
 * redirect their scope, so there is nothing meaningful to report.
 */
export class ListSuppliersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  /** One search box, sniffed into a phone lane or a name lane by the service. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @BooleanQueryParam()
  include_inactive?: boolean;
}
