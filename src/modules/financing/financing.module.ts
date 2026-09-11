import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { AdminBanksController } from './admin-banks.controller';
import { AdminFinancingController } from './admin-financing.controller';
import { AdminLoansController } from './admin-loans.controller';
import { FinancingController } from './financing.controller';
import { FinancingService } from './financing.service';
import { FundApplicationController } from './fund-application.controller';
import { FundApplicationService } from './fund-application.service';
import { LenderController } from './lender.controller';
import { LenderRequirementsService } from './lender-requirements.service';
import { LenderService } from './lender.service';

@Module({
  imports: [AuthModule, WorkshopModule],
  controllers: [
    FinancingController,
    AdminFinancingController,
    AdminBanksController,
    AdminLoansController,
    FundApplicationController,
    LenderController,
  ],
  providers: [
    FinancingService,
    LenderService,
    FundApplicationService,
    LenderRequirementsService,
  ],
  exports: [
    FinancingService,
    LenderService,
    FundApplicationService,
    LenderRequirementsService,
  ],
})
export class FinancingModule {}
