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
