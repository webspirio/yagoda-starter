import { IsOptional, IsUUID } from 'class-validator';
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * The PICKER read — one row per grade, for the operator's intake screen.
 * `CatalogPaginationQueryDto` (default 100), because this is bounded by the
 * grade count and silent truncation in a picker is the one outcome that is not
 * acceptable.
 *
 * NAMED LIMIT: an OWNER calling this with no point filter gets
 * `points × grades` rows — 5 points × 30 grades is 150, above `@Max(100)`. The
 * owner's price screen must therefore fetch one point at a time. `total` in
 * the envelope makes that visible rather than silent; the client compares
 * `data.length` against `total` and warns.
 *
 * `include_inactive` exists so the owner's price screen still shows the last
 * price of a grade retired mid-season.
 */
export class CurrentGradePricesQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @BooleanQueryParam()
  include_inactive?: boolean;
}
