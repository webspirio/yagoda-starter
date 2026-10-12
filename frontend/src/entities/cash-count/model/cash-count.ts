/** Дзеркалить `CashBook` (`cash-counts/cash-book.enum.ts`) — §7.6: одна шухляда, дві книги. */
export type CashBook = 'berry' | 'crates';

/** Дзеркалить `CashCountKind` (`cash-counts/cash-count-kind.enum.ts`). */
export type CashCountKind = 'opening' | 'midday' | 'closing';

/** Дзеркалить `CashCountRowResponse` (`cash-counts/cash-count.mapper.ts`). */
export interface CashCount {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  book: CashBook;
  kind: CashCountKind;
  counted_amount: string;
  expected_amount: string;
  /** `counted - expected`, пораховано бекендом. */
  discrepancy: string;
  /** Розбіжність є і її ще не пояснили. */
  is_open: boolean;
  counted_by_user_id: string;
  /** `displayNameOf` — `null` лише для рядків, записаних до появи цього поля. */
  counted_by_name: string | null;
  counted_at: string;
  /** Рішення керівника щодо ЦЬОГО підрахунку — текст бачить лише керівник; приймальнику `null`. */
  explanation: string | null;
  /** Чи пояснив керівник ЦЕЙ підрахунок — для всіх ролей. */
  explained: boolean;
  /** Пояснення того, хто рахував, щодо ЦЬОГО підрахунку — `is_open` не змінює. */
  operator_note: string | null;
  /** Чи може ЦЕЙ користувач (той, хто рахував) написати його зараз. */
  operator_note_editable: boolean;
  /** May THIS caller (the owner) explain this count now — the server decides. */
  explainable: boolean;
}

/** Реекспорт для існуючих імпортерів `../model/cash-count` — див. `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

export interface CashCountFilter {
  pointId?: string;
  shiftId?: string;
  from?: string;
  to?: string;
  onlyDiscrepancies?: boolean;
  page?: number;
  limit?: number;
}
