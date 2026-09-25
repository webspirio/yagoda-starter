import { IsOptional, Matches } from 'class-validator';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * #151's follow-up — the feed over a PERIOD, not only today. Both bounds are
 * inclusive LOCAL dates in `APP_TIMEZONE` (`grade_prices` has no
 * `business_date`, so the day is `created_at`'s date in the app zone).
 *
 * Both are optional: none is today, `from` alone runs to today, `to` alone is
 * that one day. The shape only is checked here; a real calendar date, the
 * order of the two and the span cap need both values at once and live in
 * `GradePricesService.changes()`.
 */
export class PriceChangesQueryDto {
  @IsOptional()
  @Matches(LOCAL_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(LOCAL_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
