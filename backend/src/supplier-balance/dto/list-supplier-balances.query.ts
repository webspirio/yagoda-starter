import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * `PaginationQueryDto` (default 20), as `ListSuppliersQueryDto` chose and for
 * its reason: the supplier table is unbounded, and this is that table with a
 * number beside each name.
 *
 * `collection_point_id` is IGNORED for an operator rather than rejected — see
 * `resolvePointFilter`'s doc comment: the parameter can neither widen nor
 * redirect their scope, so there is nothing meaningful to report.
 */
export class ListSupplierBalancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  /**
   * DEFAULTS TO FALSE — the «Залишки» screen is a list of people who are owed
   * money, and a row of `0.00` is noise on it. Note what the default does NOT
   * hide: a DEACTIVATED supplier with a balance stays listed, because a person
   * owed money must not disappear from the debts list when their card is
   * retired. Deactivation is a fact about the card; the debt is a fact about
   * the drawer.
   */
  @BooleanQueryParam()
  include_zero: boolean = false;
}
