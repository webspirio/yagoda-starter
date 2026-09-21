import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DayExpense } from './day-expense.entity';
import { DayExpensesService } from './day-expenses.service';
import { DayExpensesController } from './day-expenses.controller';
import { CostOfDayService } from './cost-of-day.service';
import { CostOfDayController } from './cost-of-day.controller';
import { NetworkAverageService } from './network-average.service';
import { NetworkAverageController } from './network-average.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DayExpense]), ShiftsModule, AuditModule],
  providers: [DayExpensesService, CostOfDayService, NetworkAverageService],
  controllers: [DayExpensesController, CostOfDayController, NetworkAverageController],
  exports: [DayExpensesService, CostOfDayService, NetworkAverageService],
})
export class DayCostsModule {}
