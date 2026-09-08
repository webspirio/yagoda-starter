import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListPayoutsQueryDto extends PaginationQueryDto {
  /** Applied through the JOIN on `shifts` — `payouts` has no point column. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** Defaults to true — §9.3, a voided document «лишається в журналі назавжди».
   *  §3.10's supplier card is «два окремі списки — квитанції й виплати». */
  @BooleanQueryParam()
  include_voided: boolean = true;
}
