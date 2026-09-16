/**
 * Minimal lookup shape for a collection point — what a select control needs,
 * plus the one figure a screen reads straight off the point.
 */
export interface PointOption {
  id: string;
  name: string;
  /**
   * The crate allotment (`target_crates`), for the «Ящики» screen's standing.
   *
   * `null` MEANS «НЕ ЗАДАНО», NOT ZERO, and the difference is load-bearing:
   * §6.9 wants «—» for a point without a target, because «нуль стверджував би,
   * що ящиків немає, тоді як ми просто не знаємо, скільки їх має бути». It also
   * blocks nothing — правка 14 overrides §9.1's «кнопка видачі неактивна».
   */
  target_crates: number | null;
}
