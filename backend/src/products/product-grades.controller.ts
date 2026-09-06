import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ProductGradesService } from './product-grades.service';
import { CreateProductGradeDto } from './dto/create-product-grade.dto';
import { UpdateProductGradeDto } from './dto/update-product-grade.dto';
import { ListProductGradesQueryDto } from './dto/list-product-grades.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Flat, not nested under `/products/:id/grades`: every later table
 * (`grade_prices`, `intake_items`) addresses a grade by id alone and never
 * mentions its product, so demanding a parent id here would be a shape unique
 * to this one module. No DELETE, no `GET /:id`.
 */
@Controller('product-grades')
export class ProductGradesController {
  constructor(private readonly grades: ProductGradesService) {}

  @Get()
  @Auth()
  list(@Query() query: ListProductGradesQueryDto) {
    return this.grades.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateProductGradeDto) {
    return this.grades.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductGradeDto,
  ) {
    return this.grades.update(actor, id, dto);
  }
}
