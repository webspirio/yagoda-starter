import type { TFunction } from 'i18next';
import type { ReceiptDocument } from '@/shared/ui/receipt';

/**
 * «Точка № N · Приймальник № M» (#145, client correction 2026-10-14). Typed `| undefined` on
 * purpose: these numbers are the only identity on the paper, so a response that lacks a key
 * prints «—», never «№ undefined».
 */
export function receiptHeader(
  t: TFunction,
  pointNumber: number | null | undefined,
  staffNumber: number | null | undefined,
): ReceiptDocument['header'] {
  return {
    point: pointNumber == null ? '—' : t('receipt.headerPoint', { number: pointNumber }),
    staff: staffNumber == null ? '—' : t('receipt.headerStaff', { number: staffNumber }),
  };
}
