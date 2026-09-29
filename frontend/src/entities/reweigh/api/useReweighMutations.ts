import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { ReweighItem } from '../model/reweigh';

export interface AddReweighItemInput {
  shiftId: string;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg?: string;
  tare: { tare_type_id: string; units: number }[];
}

/**
 * §8.1 — ONE weighing on the scale, written on its own.
 *
 * There is no document to post: the `reweighs` header is created lazily by the
 * server on the first line of a shift, and each line stands alone. The screen's
 * draft buffer is a convenience in the browser, not a document in waiting.
 *
 * `tare_weight_kg` and `net_kg` are NOT sent. The server computes both from the
 * tare catalogue and snapshots the weights onto the line (§2.5, §2.7) — a
 * client-supplied net weight would be a human's number where the schema wants
 * the scale's.
 *
 * Invalidating the whole `reweighs` prefix, not one key: the line moves this
 * shift's звірка AND its row in the day table, which is a second cache entry
 * with `includeVoided: true`.
 */
export function useAddReweighItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId, ...line }: AddReweighItemInput): Promise<ReweighItem> => {
      const { data } = await httpClient.post<ReweighItem>(`/shifts/${shiftId}/reweigh-items`, line);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.reweighs }),
  });
}

/**
 * §8.7 — the storno of ONE weighing, reason required.
 *
 * Addressed by LINE id, not by document: this backend voids a line at a time,
 * and the row stays in place with its trio so the evidence survives.
 */
export function useVoidReweighItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<ReweighItem> => {
      const { data } = await httpClient.post<ReweighItem>(`/reweigh-items/${id}/void`, { reason });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.reweighs }),
  });
}
