import { TareType } from './tare-type.entity';

/** `weight_kg` and `deposit_price` are STRINGS on the wire — `numeric` is
 *  carried end to end so no value ever passes through a binary float. */
export interface TareTypeResponse {
  id: string;
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
  created_at: string;
}

export function toTareTypeResponse(tare: TareType): TareTypeResponse {
  return {
    id: tare.id,
    name: tare.name,
    weight_kg: tare.weight_kg,
    deposit_price: tare.deposit_price,
    is_crate: tare.is_crate,
    is_active: tare.is_active,
    created_at: tare.created_at.toISOString(),
  };
}
