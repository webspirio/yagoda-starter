import { IsString, Length } from 'class-validator';

/**
 * A reason is MANDATORY, mirroring §9.3's posture on void reasons even though
 * a shift is not voided: a correction that does not say why it happened is the
 * thing the audit trail exists to prevent. §10.2 puts corrections with the
 * owner, which is why this route is the only owner-only verb on `shifts`.
 */
export class ReopenShiftDto {
  @IsString()
  @Length(1, 500)
  reason: string;
}
