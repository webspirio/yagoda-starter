import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductGrade } from './product-grade.entity';
import { ProductsService } from './products.service';
import { CreateProductGradeDto } from './dto/create-product-grade.dto';
import { UpdateProductGradeDto } from './dto/update-product-grade.dto';
import { ListProductGradesQueryDto } from './dto/list-product-grades.query';
import { ProductGradeResponse, toProductGradeResponse } from './product-grade.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const GRADE_FIELDS = ['name', 'is_active'] as const;

@Injectable()
export class ProductGradesService {
  constructor(
    @InjectRepository(ProductGrade)
    private readonly repo: Repository<ProductGrade>,
    private readonly products: ProductsService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProductGradesQueryDto): Promise<Paginated<ProductGradeResponse>> {
    const where: Record<string, unknown> = {};
    if (query.product_id) where.product_id = query.product_id;
    if (!query.include_inactive) where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      // `id: 'ASC'` is a tiebreaker, not a second sort key anyone reads: grade
      // names are unique only PER PRODUCT (`UQ_product_grades_product_name_lower`),
      // so without a `product_id` filter "1 сорт" appears once per berry — a
      // genuine tie on `name` alone. Postgres does not promise a stable order
      // among tied rows, so `skip`/`take` could return one of them twice across
      // pages, or drop it entirely, without this.
      order: { name: 'ASC', id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: data.map(toProductGradeResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** The entity, unmapped — for other modules that need to validate a grade
   *  exists and is active. Reads across domains are open; going through the
   *  owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<ProductGrade | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateProductGradeDto,
  ): Promise<ProductGradeResponse> {
    // Through the owning service, not a second query of our own: the foreign
    // key would catch an unknown product with a 500; this makes it a 404.
    const product = await this.products.findOneRaw(dto.product_id);
    if (!product) throw new NotFoundException('Product not found');

    const name = assertTrimmedName(dto.name, 'name', 'GRADE_NAME_EMPTY');
    await this.assertNameFree(dto.product_id, name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProductGrade);
      const grade = await repo.save(repo.create({ product_id: dto.product_id, name }));

      await this.audit.record(
        {
          action: 'product-grade.created',
          actor_id: actor.sub,
          target_type: 'product_grade',
          target_id: grade.id,
          after: { product_id: grade.product_id, name: grade.name },
        },
        manager,
      );

      return toProductGradeResponse(grade);
    });
  }

  /**
   * Deactivating the LAST active grade of a product is deliberately NOT
   * blocked: that is exactly how a product is retired (§4.1, with Кизил as the
   * worked example). A guard here would remove the only retirement path.
   *
   * TODO (when `grade_prices` lands): decide whether deactivating a grade that
   * has a price set for today deserves a WARNING. Expectation: no — §4.5
   * already hides an inactive grade from the intake screen. Never a refusal.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductGradeDto,
  ): Promise<ProductGradeResponse> {
    const grade = await this.repo.findOne({ where: { id } });
    if (!grade) throw new NotFoundException('Product grade not found');

    const before = { name: grade.name, is_active: grade.is_active };

    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'GRADE_NAME_EMPTY');
      if (name.toLowerCase() !== grade.name.toLowerCase()) {
        await this.assertNameFree(grade.product_id, name, grade.id);
      }
      grade.name = name;
    }
    if (dto.is_active != null) grade.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(ProductGrade).save(grade);
      const diff = diffFields(
        before,
        { name: saved.name, is_active: saved.is_active },
        GRADE_FIELDS,
      );

      if (diff) {
        await this.audit.record(
          {
            action: 'product-grade.updated',
            actor_id: actor.sub,
            target_type: 'product_grade',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toProductGradeResponse(saved);
    });
  }

  /** Scoped to the product, matching `UQ_product_grades_product_name_lower`:
   *  "1 сорт" exists for every berry, so uniqueness is per product, not global. */
  private async assertNameFree(
    productId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('grade')
      .where('grade.product_id = :productId', { productId })
      .andWhere('lower(grade.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'That grade name is already used for this product',
        code: 'GRADE_NAME_TAKEN',
      });
    }
  }
}
