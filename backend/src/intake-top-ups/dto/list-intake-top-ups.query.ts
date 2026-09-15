import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListIntakeTopUpsQueryDto extends PaginationQueryDto {
  /** Ignored for an operator — `resolvePointFilter` pins them to their point.
   *  Applied through a TWO-HOP join (`intake_top_ups → intakes → suppliers`),
   *  since neither this table nor `intakes` has a point column. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsUUID()
  intake_id?: string;

  /**
   * DEFAULTS TO TRUE, matching `ListIntakesQueryDto`. §9.3 keeps a voided
   * document in the journal «НАЗАВЖДИ з печаткою "СТОРНОВАНО"», and a voided
   * top-up is no different.
   *
   * NOTE THE ASYMMETRY WITH `counts_toward_balance`: this flag hides rows the
   * OWNER voided. A row whose PARENT was voided is never hidden by it — that
   * row is still live, it simply counts for nothing, and hiding it is exactly
   * the silence the mapper's flag exists to prevent.
   */
  @BooleanQueryParam()
  include_voided: boolean = true;
}
