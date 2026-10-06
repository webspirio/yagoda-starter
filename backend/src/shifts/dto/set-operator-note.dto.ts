import { IsString, Length, Matches } from 'class-validator';

/**
 * Spec 2026-10-06 — the closing operator's account, same shape as
 * `SetExplanationDto`. It informs the owner and closes nothing: `is_open`
 * still waits for `explanation`.
 */
export class SetOperatorNoteDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'operator_note must not be blank' })
  operator_note: string;
}
