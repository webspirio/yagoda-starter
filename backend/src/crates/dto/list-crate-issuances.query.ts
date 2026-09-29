import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CrateIssuanceMode } from '../crate-issuance-mode.enum';

/**
 * `voided` IS THREE-VALUED ON PURPOSE. Unset hides voided rows (the journal);
 * `true` shows ONLY them, which is the owner's incident list — the crate
 * equivalent of `GET /cash-counts?only_discrepancies=true`, and what «notify
 * the owner» means in a project with no email. `include_voided=true` shows
 * both.
 */
export class ListCrateIssuancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsEnum(CrateIssuanceMode)
  mode?: CrateIssuanceMode;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  voided?: boolean;

  /**
   * Live AND voided together — the per-person document list on «Ящики», where
   * a voided line stays visible, struck through (§9.3). The same name every
   * other document list uses. `voided=true` still wins: it means ONLY voided.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_voided?: boolean;
}
