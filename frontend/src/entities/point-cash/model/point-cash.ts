/**
 * Дзеркалить бекендовий `TransferStatus` (`transfers/transfer-status.enum.ts`),
 * а НЕ імпортується з `entities/transfer` — FSD забороняє cross-import у
 * межах шару (`entities/point-cash` -> `entities/transfer`). Дублікат
 * супроводжується цим коментарем, як `Paginated` в `entities/payout`.
 */
export type TransferStatus = 'sent' | 'accepted' | 'disputed';

/**
 * Дзеркалить `PointCashRowResponse` (`point-cash/point-cash.mapper.ts`) —
 * один рядок екрана «Каса точки» / мережевої таблиці §7.10.
 */
export interface PointCashRow {
  collection_point_id: string;
  name: string;
  /** `null` = наділу не призначали. НЕ нуль — §6.9. */
  target_cash: string | null;
  cash: string;
  /** `null` коли `target_cash` порожній: порівнювати нема з чим (§7.10). */
  shortfall: string | null;
  unexplained_difference: string;
  latest_transfer: { status: TransferStatus; sent_at: string } | null;
}

/** Дзеркалить відповідь `GET /point-cash/:pointId` — лише сума однієї точки. */
export interface PointCashOne {
  collection_point_id: string;
  cash: string;
}

/**
 * Дубльовано з `entities/transfer/model/transfer.ts`, а не імпортовано — FSD
 * забороняє cross-import у межах шару. Це зафіксована ціна методології.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
