import { Supplier } from './supplier.entity';
import { SupplierKind } from './supplier-kind.enum';

/** `created_at` only, no `updated_at` — matching every other mapper in this
 *  codebase. "When did this change" is the audit log's question. */
export interface SupplierResponse {
  id: string;
  collection_point_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  note: string | null;
  kind: SupplierKind;
  is_active: boolean;
  created_at: string;
}

export function toSupplierResponse(supplier: Supplier): SupplierResponse {
  return {
    id: supplier.id,
    collection_point_id: supplier.collection_point_id,
    first_name: supplier.first_name,
    last_name: supplier.last_name,
    phone: supplier.phone,
    note: supplier.note,
    kind: supplier.kind,
    is_active: supplier.is_active,
    created_at: supplier.created_at.toISOString(),
  };
}
