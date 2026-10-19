import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

/** §6.8's three numbers, as `GET /shifts/:id/crates` returns them. */
export interface CrateDispatch {
  /** Σ ящиків на живих квитанціях зміни. `0` — рахували й не знайшли жодного. */
  with_berry: number;
  /** `shifts.broken_crates`. `null` поки зміна відкрита — «не записано». */
  broken: number | null;
  /** `with_berry + broken`, або `null` поки `broken` такий. Ніде не зберігається. */
  dispatched: number | null;
}

/**
 * ЧОМУ ЦЕ ТУТ, А НЕ В `entities/crate`. Читання має РІВНО ОДНОГО споживача —
 * діалог закриття зміни в цій же фічі. FSD 5-1: не виносити код, що вживається
 * в одному місці; другий споживач і заробить собі сутність.
 *
 * `shiftId === null` — це режим ВІДКРИТТЯ того ж діалогу, де питати нема про
 * що: запит вимкнено, а не відправлено на `/shifts/null/crates`.
 */
export function useCrateDispatchQuery(shiftId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.crates, 'dispatch', shiftId] as const,
    queryFn: async (): Promise<CrateDispatch> =>
      (await httpClient.get<CrateDispatch>(`/shifts/${shiftId}/crates`)).data,
    enabled: shiftId !== null,
    // Свіжість тут не налаштовується: `queryKeys.crates` поза allowlist
    // `shared/api/cachePolicy.ts`, тож кожне відкриття діалогу — свіжий запит,
    // хоча жодна мутація квитанції цей ключ не інвалідовує (§6.8).
  });
}
