/**
 * Minimal lookup shape for a collection point — what a select control needs,
 * plus the one fact a screen has to know ABOUT the point rather than from it.
 */
export interface PointOption {
  id: string;
  name: string;
  /**
   * `'reception'` or `'base'` — §4.8's склад.
   *
   * THE ENUM SPELLS THE WAREHOUSE `base`, not `warehouse`, because §8.1 also
   * re-weighs there. Reading the wrong string finds nothing and silently
   * treats the warehouse as an ordinary point.
   */
  kind: 'reception' | 'base';
}
