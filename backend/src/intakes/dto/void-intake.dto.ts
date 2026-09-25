import { IsIn, IsOptional } from 'class-validator';
import { VoidDocumentDto } from './void-document.dto';

const PAYOUT_DECISIONS = ['keep', 'void', 'void_returned'] as const;
export type PayoutDecision = (typeof PAYOUT_DECISIONS)[number];

/** §9.3 + #125: what happens to the payout issued with this receipt. Required iff one is live. */
export class VoidIntakeDto extends VoidDocumentDto {
  @IsOptional()
  @IsIn(PAYOUT_DECISIONS)
  payout?: PayoutDecision;
}
