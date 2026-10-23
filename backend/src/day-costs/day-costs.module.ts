import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DayExpense } from './day-expense.entity';
import { DayExpensesService } from './day-expenses.service';
import { DayExpensesController } from './day-expenses.controller';
import { CostOfDayService } from './cost-of-day.service';
import { CostOfDayController } from './cost-of-day.controller';
import { NetworkCostOfDayService } from './network-cost-of-day.service';
import { NetworkCostOfDayController } from './network-cost-of-day.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DayExpense]), ShiftsModule, AuditModule],
  providers: [DayExpensesService, CostOfDayService, NetworkCostOfDayService],
  controllers: [DayExpensesController, CostOfDayController, NetworkCostOfDayController],
  exports: [DayExpensesService, CostOfDayService, NetworkCostOfDayService],
})
export class DayCostsModule {}
