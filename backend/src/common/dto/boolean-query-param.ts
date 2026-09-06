import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * The one answer to "is this query flag on?".
 *
 * It replaces `@IsBooleanString()`, which accepted `'1'`, `'0'` and `'TRUE'`
 * while every consuming service compared `=== 'true'` — so `?flag=1` passed
 * validation and then silently meant FALSE. A flag that is accepted and
 * ignored is worse than one that is rejected: the caller believes it worked.
 *
 * Unrecognised input is deliberately returned UNCHANGED rather than coerced or
 * thrown on here. Leaving it a string lets `@IsBoolean()` reject it through the
 * normal validation pipeline, so the caller gets a 400 with a field name and
 * the global ValidationPipe's usual shape — not an exception raised from inside
 * a transformer, which bypasses that machinery.
 */
export function toBooleanQueryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}

export const BooleanQueryParam = (): PropertyDecorator =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }: { value: unknown }) => toBooleanQueryValue(value)),
    IsBoolean(),
  );
