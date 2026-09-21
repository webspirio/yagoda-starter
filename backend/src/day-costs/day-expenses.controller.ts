import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { DayExpensesService } from './day-expenses.service';
import { CreateDayExpenseDto } from './dto/create-day-expense.dto';
import { UpdateDayExpenseDto } from './dto/update-day-expense.dto';
import { DayExpense } from './day-expense.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8.3 — owner only, throughout. «підпис рядка пише керівник».
 */
@Controller()
@Auth(UserRole.NetworkOwner)
export class DayExpensesController {
  constructor(private readonly dayExpenses: DayExpensesService) {}

  @Post('shifts/:shiftId/expenses')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: CreateDayExpenseDto,
  ): Promise<DayExpense> {
    return this.dayExpenses.create(actor, shiftId, dto);
  }

  @Get('shifts/:shiftId/expenses')
  list(@Param('shiftId', ParseUUIDPipe) shiftId: string): Promise<DayExpense[]> {
    return this.dayExpenses.listForShift(shiftId);
  }

  @Patch('expenses/:id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDayExpenseDto,
  ): Promise<DayExpense> {
    return this.dayExpenses.update(actor, id, dto);
  }

  @Delete('expenses/:id')
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.dayExpenses.remove(actor, id);
  }
}
