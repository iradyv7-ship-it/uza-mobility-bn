import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { HealthController } from './health/health.controller';
import { AppService } from './app.service';
import { AuditModule } from './common/audit/audit.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { HttpLoggingInterceptor } from './common/logging/http-logging.interceptor';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ListingsModule } from './modules/listings/listings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { OrdersModule } from './modules/orders/orders.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { PartsModule } from './modules/parts/parts.module';
import { EnergyModule } from './modules/energy/energy.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { SustainabilityModule } from './modules/sustainability/sustainability.module';
import { FinancingModule } from './modules/financing/financing.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { BankFilesModule } from './modules/bank-files/bank-files.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { ChargingStationsModule } from './modules/charging-stations/charging-stations.module';
import { WorkshopModule } from './modules/workshop/workshop.module';
import { AcademyModule } from './modules/academy/academy.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ImpactModule } from './modules/impact/impact.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { PdfModule } from './common/pdf/pdf.module';
import { UploadsModule } from './common/uploads/uploads.module';
import { MongoModule } from './mongo/mongo.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Refuse to start with a configuration that would send a real user to localhost.
      // See src/config/env.validation.ts for each rule and the failure it prevents.
      validate: validateEnv,
    }),
    // Rate limiting. Two named windows rather than one, because the right limit for
    // browsing listings is far too generous for a login form: 100 attempts a minute is
    // normal traffic on a catalogue and a brute-force attack on a password.
    //
    // Applied globally by ThrottlerGuard below. Routes that need the strict window opt in
    // with @Throttle({ auth: { limit: 5, ttl: 60000 } }) — start with auth/login,
    // auth/register, forgot-password and reset-password.
    /*
     * One global window, deliberately.
     *
     * Every named definition passed here applies to EVERY route — a second, tighter
     * definition does not sit dormant waiting to be opted into, it throttles the whole
     * API at the tighter limit. That mistake reduced the entire platform to five
     * requests a minute and was only visible by loading a real page.
     *
     * So the global ceiling is the ordinary one, and the six brute-forceable auth
     * routes override it in place with `@Throttle({ default: { limit: 5, ... } })`.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    MongoModule,
    UploadsModule,
    PdfModule,
    /**
     * The three scheduled jobs (invoices at midnight, promotions at 01:00, the covenant
     * morning run at 05:00) must run on exactly one instance. Behind a load balancer with two
     * API replicas, both would fire and every driver would be warned twice. CRON_ENABLED=false
     * on all replicas but one — or on all of them, with the jobs triggered by an external
     * scheduler through the admin endpoints — keeps that from happening. Default is on, so a
     * single-instance deployment needs no extra configuration.
     */
    ...(process.env.CRON_ENABLED?.trim().toLowerCase() === 'false'
      ? []
      : [ScheduleModule.forRoot()]),
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    AdminModule,
    CategoriesModule,
    ListingsModule,
    NotificationsModule,
    PricingModule,
    InvoicesModule,
    PaymentsModule,
    OrdersModule,
    FleetModule,
    PartsModule,
    EnergyModule,
    SellersModule,
    PromotionsModule,
    SustainabilityModule,
    FinancingModule,
    BookingsModule,
    BankFilesModule,
    InquiriesModule,
    PlatformSettingsModule,
    ChargingStationsModule,
    WorkshopModule,
    AcademyModule,
    WalletModule,
    ImpactModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    // Global. Every route gets the 'default' window; the strict 'auth' window is opted
    // into per route with @Throttle, because a limit that hurts nobody protects nobody.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
