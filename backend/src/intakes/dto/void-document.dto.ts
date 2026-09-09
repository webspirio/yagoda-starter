import { IsString, Length } from 'class-validator';

/**
 * Shared by `intakes` and `payouts`: §9.3 governs both identically — «сторно
 * повне, з обов'язковою причиною» — and two copies of one rule drift.
 *
 * The reason is MANDATORY, and that is the whole argument for why voiding is a
 * trio of columns rather than a status value: «спроба сторнувати без причини →
 * кнопка неактивна», and a status carries no reason. `transfer_status` lost its
 * `void` member on 03.09.2026 for exactly this.
 */
export class VoidDocumentDto {
  @IsString()
  @Length(1, 500)
  reason: string;
}
