import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Supplier } from './supplier.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export function visibleTo(actor: AuthenticatedUser, supplier: Supplier): boolean {
  if (actor.role === UserRole.NetworkOwner) return true;
  return actor.collection_point_id === supplier.collection_point_id;
}

/**
 * The friendly 409. `UQ_suppliers_point_phone` is the real guarantee — this
 * is a check-then-act and two concurrent creates can both pass it, leaving
 * the loser with a 500 instead of a 409. That matches the pre-existing shape
 * in `CollectionPointsService`, `UserAdminService` and the three catalog
 * services; recorded for consistency, not as a new defect.
 */
export async function assertPhoneFree(
  repo: Repository<Supplier>,
  pointId: string,
  phone: string,
  excludeId?: string,
): Promise<void> {
  const existing = await repo
    .createQueryBuilder('s')
    .where('s.collection_point_id = :pointId AND s.phone = :phone', { pointId, phone })
    .getOne();

  if (existing && existing.id !== excludeId) {
    throw new ConflictException({
      message: 'A supplier with that phone already exists at this point',
      code: 'SUPPLIER_PHONE_TAKEN',
    });
  }
}
