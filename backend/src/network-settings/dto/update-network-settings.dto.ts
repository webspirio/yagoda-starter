import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * `null` clears the note. Whether it FITS the receipt is the command's check
 * (`canonicalReceiptNote`) — a validator here could only answer with a
 * code-less 400. `MaxLength` just stops an absurd body before it is split.
 */
export class UpdateNetworkSettingsDto {
  @ValidateIf(
    (o: UpdateNetworkSettingsDto) => o.receipt_note !== undefined && o.receipt_note !== null,
  )
  @IsString()
  @MaxLength(1000)
  receipt_note?: string | null;
}
