import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * There is no DELETE here and there never will be — deactivation is this
 * domain's only removal verb, and `products` does not even have that: a product
 * is retired by deactivating its grades (§4.1).
 *
 * There is no `GET /:id` either: the list returns the whole catalog in one
 * request, so nothing needs a single-row read.
 *
 * Reads are open to both roles — the operator's intake screen needs the whole
 * catalog. Writes are owner-only: §10.1 knows two roles, and everything
 * configurable belongs to the керівник.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Auth()
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.products.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(actor, id, dto);
  }
}
