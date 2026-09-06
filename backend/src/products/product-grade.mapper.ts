import { ProductGrade } from './product-grade.entity';

/** `product_id` IS in the response — the client builds its product→grades tree
 *  from it — and is NOT in the update DTO: a grade never changes parent. */
export interface ProductGradeResponse {
  id: string;
  product_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function toProductGradeResponse(grade: ProductGrade): ProductGradeResponse {
  return {
    id: grade.id,
    product_id: grade.product_id,
    name: grade.name,
    is_active: grade.is_active,
    created_at: grade.created_at.toISOString(),
  };
}
