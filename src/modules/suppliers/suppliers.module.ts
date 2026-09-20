import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupplierOfferDocumentsService } from './supplier-offer-documents.service';
import { SupplierOffersController } from './supplier-offers.controller';
import { SupplierOffersService } from './supplier-offers.service';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierRegistrationController } from './supplier-registration.controller';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * The supplier/vendor portal.
 *
 * Three audiences, three controllers, and keeping them apart is the design:
 *   · `SupplierRegistrationController` — public. One route, one class, so "public" is a
 *     property of the file rather than an exception inside a guarded one.
 *   · `SuppliersController` / `SupplierOffersController` — UZA sourcing staff.
 *   · `SupplierPortalController` — the supplier's own login, scoped by CounterpartyAccess.
 *
 * PrismaModule, AuditModule and MongoModule are all @Global, so only AuthModule is
 * imported here — the same shape as WalletModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SupplierRegistrationController,
    SuppliersController,
    SupplierOffersController,
    SupplierPortalController,
  ],
  providers: [
    SuppliersService,
    SupplierOffersService,
    SupplierOfferDocumentsService,
  ],
  exports: [SuppliersService, SupplierOffersService],
})
export class SuppliersModule {}
