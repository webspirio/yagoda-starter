import { Module } from '@nestjs/common';
import { JournalTotalsQuery } from './queries/journal-totals.query';
import { JournalTotalsController } from './journal-totals.controller';

/** Reads `intakes` and `payouts` across their modules (reads are open); owns no table. */
@Module({
  providers: [JournalTotalsQuery],
  controllers: [JournalTotalsController],
})
export class JournalModule {}
