import { Product } from './product.entity';

/** `created_at` only, no `updated_at` — matching `toCollectionPointResponse`.
 *  "When did this change" is the audit log's question, not the row's. */
export interface ProductResponse {
  id: string;
  name: string;
  created_at: string;
}

export function toProductResponse(product: Product): ProductResponse {
  return {
    id: product.id,
    name: product.name,
    created_at: product.created_at.toISOString(),
  };
}
