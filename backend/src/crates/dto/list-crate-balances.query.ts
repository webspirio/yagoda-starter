import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * The «Ящики» screen's list — every supplier still holding crates at a point,
 * on one page, where `GET /suppliers/:id/crate-balance` answers for one person
 * at a time.
 *
 * THE SAME PAIR `supplier-balance` ALREADY HAS, for the same reason: the
 * single read hangs off `/suppliers/:id`, and a list belongs under its own
 * noun. Keeping the shapes parallel is deliberate — a reader who has met one
 * has met both.
 *
 * `include_zero` DEFAULTS TO FALSE. A supplier who has brought everything back
 * is not «holding crates», and a screen titled «У людей» that listed them
 * would be answering a different question than it asks. The flag exists
 * because the owner auditing a season does want the whole roster.
 */
export class ListCrateBalancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @BooleanQueryParam()
  include_zero: boolean = false;
}
