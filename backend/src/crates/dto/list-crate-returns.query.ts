import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * `voided` IS THREE-VALUED ON PURPOSE — see `ListCrateIssuancesQueryDto`'s
 * doc comment; the same rule applies here, minus `mode`, which returns don't
 * carry (a return can consume tranches from both). `include_voided=true`
 * shows both.
 */
export class ListCrateReturnsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

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
