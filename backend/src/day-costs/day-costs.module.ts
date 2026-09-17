import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DayExpense } from './day-expense.entity';
import { DayExpensesService } from './day-expenses.service';
import { DayExpensesController } from './day-expenses.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DayExpense]), ShiftsModule, AuditModule],
  providers: [DayExpensesService],
  controllers: [DayExpensesController],
  exports: [DayExpensesService],
})
export class DayCostsModule {}
