import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * The template-wide pagination convention for collection endpoints:
 * `?page=2&limit=20`, combined with the Paginated<T> response envelope
 * (src/common/dto/paginated.ts). Copy this pair for every new list endpoint —
 * an unpaginated find() works in a demo and melts down at real row counts.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

/**
 * The `skip` for a page. Trivial arithmetic, but it lives here for two reasons:
 * every list endpoint repeats it verbatim, and the modules that handle money
 * ban `*` outright (see `eslint.config.mjs`) so that a `price * kg` cannot slip
 * into a service. A page offset is neither money nor weight; putting it behind
 * a named helper keeps that ban strict rather than teaching people to write
 * disable comments next to it.
 */
export function skipOf({ page, limit }: PaginationQueryDto): number {
  return (page - 1) * limit;
}
