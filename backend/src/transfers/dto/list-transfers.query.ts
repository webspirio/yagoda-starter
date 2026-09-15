import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';
import { TransferStatus } from '../transfer-status.enum';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListTransfersQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  /**
   * `from`/`to` FILTER ON `sent_at`, NOT ON `accepted_date`, and the choice
   * matters: a `sent` transfer has no `accepted_date` at all, so filtering on
   * that column would hide exactly the in-flight rows the owner opens this
   * list to see. The dispatch day is the only date every transfer has.
   */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** §9.3 — a voided document «лишається в журналі назавжди», but the default
   *  list is the working one. Matches `GET /intakes`. */
  @BooleanQueryParam()
  include_voided: boolean = false;
}
