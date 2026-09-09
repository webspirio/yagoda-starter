import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListIntakesQueryDto extends PaginationQueryDto {
  /** Ignored for an operator — `resolvePointFilter` pins them to their point.
   *  Applied through the JOIN on `shifts`, since `intakes` has no point column. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  /** Inclusive bounds on the SHIFT's `business_date`. */
  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /**
   * DEFAULTS TO TRUE — the journal is the default view. §9.3: a voided document
   * «лишається в журналі НАЗАВЖДИ з печаткою "СТОРНОВАНО"», and §11.5 calls the
   * screen «Журнал прийомки — усі квитанції поспіль». Hiding them by default
   * would make a voided receipt invisible to the person holding its paper.
   */
  @BooleanQueryParam()
  include_voided: boolean = true;
}
