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
  /** Сума завдатків, які досі утримано (крейти видані «за кошти», ще не повернуті). */
  crate_deposits: string;
  /** §R8 — скільки ящиків з тих завдатків: видано «за кошти» мінус повернуто. */
  crate_deposit_units: number;
}

/** Дзеркалить `PointCashBreakdown` (`point-cash/point-cash.mapper.ts`, #73). */
export type PointCashBreakdownKind = 'open' | 'closed' | 'carried' | 'none';

export interface PointCashBreakdown {
  kind: PointCashBreakdownKind;
  anchor_date: string | null;
  opening: string | null;
  transfers_in: string | null;
  /** Невід'ємна величина — знак ставить екран. */
  payouts: string | null;
  returns: string | null;
  closing: {
    counted: string;
    /** Знімок при закритті, не перерахунок. */
    expected: string | null;
    difference: string | null;
    late_change: string | null;
  } | null;
}

/** Дзеркалить відповідь `GET /point-cash/:pointId` — сума однієї точки і розклад, з якого вона складається. */
export interface PointCashOne {
  collection_point_id: string;
  cash: string;
  /** Сума завдатків, які досі утримано (крейти видані «за кошти», ще не повернуті). */
  crate_deposits: string;
  /** §R8 — скільки ящиків з тих завдатків: видано «за кошти» мінус повернуто. */
  crate_deposit_units: number;
  breakdown: PointCashBreakdown;
}

/** Реекспорт для існуючих імпортерів `../model/point-cash` — див. `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';
