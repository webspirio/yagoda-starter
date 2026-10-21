import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { visibleTo } from '../supplier-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * 404 — NOT 403 — for a supplier at another point. `GET
 * /collection-points/:id` distinguishes the two, and the foundation
 * follow-ups flag that as a weak existence oracle «worth remembering before
 * this shape is copied onto a guessable id». This is the copy, and these
 * rows are real people's names and phone numbers.
 *
 * Exported: every module that takes a `supplier_id` (intakes, payouts, crates,
 * supplier-balance) validates it here rather than growing its own query.
 */
@Injectable()
export class FindSupplierQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async findOne(actor: AuthenticatedUser, id: string): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier || !visibleTo(actor, supplier)) {
      throw new NotFoundException('Supplier not found');
    }
    return toSupplierResponse(supplier);
  }
}
