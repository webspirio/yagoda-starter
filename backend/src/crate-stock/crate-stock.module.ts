import { Module } from '@nestjs/common';
import { CrateStockGuard } from './crate-stock.guard';

/** A LEAF on purpose: `CratesModule` imports `ShiftsModule`, so the guard that
 *  `ShiftsModule` needs cannot live in `CratesModule`. It reads SQL fragments from
 *  the crates FILE, as `point-cash` does, and imports no domain module. */
@Module({ providers: [CrateStockGuard], exports: [CrateStockGuard] })
export class CrateStockModule {}
