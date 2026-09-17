import { IsNotEmpty, Matches } from 'class-validator';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `date` is required — §8.6 answers one specific business date, never "all
 *  time" or "today by default"; the caller states which day. Same pattern
 *  as `ListShiftsQueryDto`'s `from`/`to`, compared as a `date` in Postgres
 *  so no timezone enters the query. */
export class NetworkAverageQueryDto {
  @IsNotEmpty({ message: 'date is required' })
  @Matches(BUSINESS_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;
}
