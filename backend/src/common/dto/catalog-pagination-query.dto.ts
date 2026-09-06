import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

/**
 * Pagination for a BOUNDED reference table read by a picker, not a browsable
 * list. `PaginationQueryDto`'s default of 20 is right for users and documents
 * and wrong here, and wrong QUIETLY: ten products at three grades apiece is 30
 * rows, so an operator opens the grade picker on the intake screen, the last
 * third of the catalog is not there, and nothing errors.
 *
 * `@Max(100)` is unchanged — the guard rail against an unbounded query stays.
 * Clients compare `data.length` against `total` and warn if they differ: if
 * this business ever exceeds 100 grades the assumption behind this default has
 * broken and someone must know, because silent truncation is the one outcome
 * that is not acceptable.
 *
 * `limit` MUST carry an initializer here. This repo targets ES2023, so
 * `useDefineForClassFields` is TRUE and a re-declared field without one would
 * define `limit` as `undefined`, wiping the parent's default rather than
 * raising it.
 */
export class CatalogPaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
}
