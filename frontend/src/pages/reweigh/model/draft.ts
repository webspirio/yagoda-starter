import { mul, sub, sum } from '@/shared/lib/money';

/** One tare type on a line: which crate, how many of them. */
export interface DraftTare {
  tare_type_id: string;
  units: number;
}

/**
 * A position that lives in the memory of the PAGE — there is no document yet.
 *
 * `tare_weight_kg` and `net_kg` are a PREVIEW, computed here so the owner sees
 * the чиста вага fall out of the gross under their hands. The server computes
 * both again from the tare catalogue and snapshots ITS values onto the line;
 * after the post, the list shows the server's. If the two ever disagree, the
 * server is right and the screen is stale — never the other way round.
 */
export interface Draft {
  /** Client-side only; never sent. */
  key: string;
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  gross_kg: string;
  pallet_kg: string;
  tare: DraftTare[];
  tare_weight_kg: string;
  net_kg: string;
}

let counter = 0;
export function newDraftKey(): string {
  counter += 1;
  return `rwl_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `Σ units × weight_kg` from the tare catalogue.
 *
 * A tare type the catalogue does not carry contributes NOTHING rather than a
 * guessed weight: the picker only offers live types, and inventing a weight
 * for an unknown one would print a чиста вага that the server then refuses —
 * the owner would see a number change for no reason they can see.
 */
export function tareWeightOf(tare: DraftTare[], weightById: Map<string, string>): string {
  return sum(
    tare.map((t) => {
      const weight = weightById.get(t.tare_type_id);
      return weight === undefined ? '0.00' : mul(weight, t.units);
    }),
  );
}

/** §8.1: pallet FIRST, tare second. Never a human's number. */
export function netOf(gross: string, pallet: string, tareWeight: string): string {
  return sub(sub(gross, pallet), tareWeight);
}
