/** Дзеркалить бекендовий `TransferStatus` (`transfers/transfer-status.enum.ts`). */
export type TransferStatus = 'sent' | 'accepted' | 'disputed';

/** Дзеркалить `TransferResponse` (`transfers/transfer.mapper.ts`). */
export interface Transfer {
  id: string;
  collection_point_id: string;
  /** Скільки відправили. Рядок — гроші ніколи не `number`. */
  cash: string;
  crates: number;
  carrier: string;
  sent_by_user_id: string;
  sent_at: string;
  status: TransferStatus;
  accepted_by_user_id: string | null;
  /** Бізнес-дата зміни, В ЯКІЙ переказ прийняли — не день відправлення. */
  accepted_date: string | null;
  accepted_at: string | null;
  /** Скільки нарахувала точка, коли не зійшлося. */
  reported_cash: string | null;
  reported_crates: number | null;
  dispute_note: string | null;
  /** Чим керівник закрив спір. */
  resolved_cash: string | null;
  resolved_crates: number | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  /** Різниця, порахована бекендом; `null` поки спору немає. */
  cash_discrepancy: string | null;
  crates_discrepancy: number | null;
  correction_of_transfer_id: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * Дубльовано з `entities/payout/model/payout.ts`, а не імпортовано — FSD
 * забороняє cross-import у межах шару. Це зафіксована ціна методології.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TransferFilter {
  pointId?: string;
  status?: TransferStatus;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  page?: number;
  limit?: number;
}
