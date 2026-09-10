import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { AdminBanksController } from './admin-banks.controller';
import { AdminFinancingController } from './admin-financing.controller';
import { AdminLoansController } from './admin-loans.controller';
import { FinancingController } from './financing.controller';
import { FinancingService } from './financing.service';
import { LenderController } from './lender.controller';
import { LenderService } from './lender.service';

@Module({
  imports: [AuthModule, WorkshopModule],
  controllers: [
    FinancingController,
    AdminFinancingController,
    AdminBanksController,
    AdminLoansController,
    LenderController,
  ],
  providers: [FinancingService, LenderService],
  exports: [FinancingService, LenderService],
})
export class FinancingModule {}
