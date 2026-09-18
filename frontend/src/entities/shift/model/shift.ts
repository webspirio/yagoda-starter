/** Mirrors the backend's `ShiftResponse` (intakes spec §4). */
export type ShiftStatus = 'open' | 'awaiting_explanation' | 'closed';

export interface Shift {
  id: string;
  collection_point_id: string;
  /** `YYYY-MM-DD` in APP_TIMEZONE — the day the shift belongs to, not the wall clock. */
  business_date: string;
  status: ShiftStatus;
  opened_by_user_id: string;
  closed_by_user_id: string | null;
  closed_at: string | null;
  created_at: string;
  /**
   * Пояснення керівника до розбіжності в підрахунку каси (§7.7 у редакції
   * 09.09.2026: розбіжність НІКОЛИ не блокує закриття, керівник пояснює
   * постфактум). `null` — або розбіжності не було, або її ще не пояснили.
   */
  explanation: string | null;
  /**
   * §6.8's «бій» (#110) — скільки ящиків побилось за зміну. `null` означає «не
   * записано»: або зміна ще відкрита, або її закрили до появи колонки. `0` —
   * це НЕ те саме: це «нічого не побилось». Не зводьте одне до одного.
   */
  broken_crates: number | null;
}
