import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product } from './product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { ProductResponse, toProductResponse } from './product.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProductsQueryDto): Promise<Paginated<ProductResponse>> {
    const [data, total] = await this.repo.findAndCount({
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toProductResponse), total, page: query.page, limit: query.limit };
  }

  /** The entity, unmapped — for `ProductGradesService`, which must confirm a
   *  product exists before hanging a grade off it. Reads across modules are
   *  open; going through the owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<Product | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(actor: AuthenticatedUser, dto: CreateProductDto): Promise<ProductResponse> {
    const name = assertTrimmedName(dto.name, 'name', 'PRODUCT_NAME_EMPTY');
    await this.assertNameFree(name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Product);
      const product = await repo.save(repo.create({ name }));

      await this.audit.record(
        {
          action: 'product.created',
          actor_id: actor.sub,
          target_type: 'product',
          target_id: product.id,
          after: { name: product.name },
        },
        manager,
      );

      return toProductResponse(product);
    });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const before = { name: product.name };

    // `!= null`, not `!== undefined`: the DTO rejects an explicit null with a
    // 400, and this guard stays defensive rather than trusting that alone.
    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'PRODUCT_NAME_EMPTY');
      // Compared case-INSENSITIVELY, matching the unique index. A pure case
      // correction ("малина" → "Малина") is the same row, so it must not be
      // checked against itself and must not 409.
      if (name.toLowerCase() !== product.name.toLowerCase()) {
        await this.assertNameFree(name, product.id);
      }
      product.name = name;
    }

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Product).save(product);
      const diff = diffFields(before, { name: saved.name }, ['name']);

      // A no-op PATCH must not write an entry: an audit log full of noise is
      // one nobody reads.
      if (diff) {
        await this.audit.record(
          {
            action: 'product.updated',
            actor_id: actor.sub,
            target_type: 'product',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toProductResponse(saved);
    });
  }

  /**
   * A pre-check for a friendly 409. `UQ_products_name_lower` is still the real
   * guarantee — two simultaneous writes both pass this, and the loser gets a
   * 500 rather than a silent duplicate.
   *
   * `lower(...) = lower(...)` on BOTH sides, matching the index exactly: a
   * case-sensitive pre-check would let «малина» through to a constraint
   * violation, turning a 409 into a 500.
   */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('product')
      .where('lower(product.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'PRODUCT_NAME_TAKEN' });
    }
  }
}
