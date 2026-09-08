import { IsOptional, IsString, Length } from 'class-validator';

/**
 * OPTIONAL note, unlike a void reason — §9.3 makes the REASON for a void
 * mandatory and says nothing about annotating the cash coming back.
 *
 * There is no `amount` field and there must not be one: the sum returned always
 * equals `payouts.amount` («внесення завжди на всю суму: часткового не буває»),
 * and a second copy is what the DBML header forbids.
 */
export class SettleReturnDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
