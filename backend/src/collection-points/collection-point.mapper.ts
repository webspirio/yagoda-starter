import { CollectionPoint } from './collection-point.entity';
import { PointKind } from './point-kind.enum';

export interface CollectionPointResponse {
  id: string;
  name: string;
  kind: PointKind;
  /** `numeric` — a string, or null for "not set". NEVER 0, and never a number:
   *  a client that receives 0 cannot tell an unset target from a zero one, and
   *  §6.9 needs exactly that distinction to render "—". */
  target_cash: string | null;
  target_crates: number | null;
  is_active: boolean;
  created_at: string;
}

export function toCollectionPointResponse(point: CollectionPoint): CollectionPointResponse {
  return {
    id: point.id,
    name: point.name,
    kind: point.kind,
    target_cash: point.target_cash,
    target_crates: point.target_crates,
    is_active: point.is_active,
    created_at: point.created_at.toISOString(),
  };
}
