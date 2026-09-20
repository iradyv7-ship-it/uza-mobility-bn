import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { UsersModule } from '../../users/users.module';
import { AdminBanksController } from './admin-banks.controller';
import { AdminFinancingController } from './admin-financing.controller';
import { AdminLoanLifecycleController } from './admin-loan-lifecycle.controller';
import { AdminLoansController } from './admin-loans.controller';
import { FinancingController } from './financing.controller';
import { FinancingService } from './financing.service';
import { FundApplicationController } from './fund-application.controller';
import { FundApplicationDocumentsService } from './fund-application-documents.service';
import { FundApplicationService } from './fund-application.service';
import { LenderController } from './lender.controller';
import { LenderRequirementsService } from './lender-requirements.service';
import { LenderService } from './lender.service';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { LoanServicingService } from './loan-servicing.service';
import { AcademyModule } from '../academy/academy.module';
import { EmpowerSupportController } from './empower-support.controller';
import { WalletModule } from '../wallet/wallet.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import {
  AdminLoanScenarioController,
  ScenarioController,
} from './scenario.controller';
import { ScenarioService } from './scenario.service';

@Module({
  imports: [
    AuthModule,
    WorkshopModule,
    AcademyModule,
    WalletModule,
    PlatformSettingsModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [
    FinancingController,
    AdminFinancingController,
    AdminBanksController,
    AdminLoansController,
    AdminLoanLifecycleController,
    FundApplicationController,
    EmpowerSupportController,
    LenderController,
    ScenarioController,
    AdminLoanScenarioController,
  ],
  providers: [
    FinancingService,
    LenderService,
    FundApplicationService,
    FundApplicationDocumentsService,
    LenderRequirementsService,
    LoanLifecycleService,
    LoanServicingService,
    ScenarioService,
  ],
  exports: [
    FinancingService,
    LenderService,
    FundApplicationService,
    LenderRequirementsService,
    LoanLifecycleService,
  ],
})
export class FinancingModule {}
