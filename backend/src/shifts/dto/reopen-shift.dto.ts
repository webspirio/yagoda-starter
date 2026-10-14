import { IsString, Length, Matches } from 'class-validator';

/**
 * A reason is MANDATORY, mirroring §9.3's posture on void reasons even though
 * a shift is not voided: a correction that does not say why it happened is the
 * thing the audit trail exists to prevent. §10.2 puts corrections with the
 * owner, which is why this route is the only owner-only verb on `shifts`.
 */
export class ReopenShiftDto {
  @IsString()
  @Length(1, 500)
  // `@Length(1, …)` counts characters, so `{"reason":"   "}` satisfies it and
  // the audit entry this route exists to write ends up saying nothing. Same
  // decorator, same reasoning and same wording as `VoidDocumentDto` — a
  // mandatory reason has to mean non-blank, or it means «the button was
  // disabled».
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason: string;
}
