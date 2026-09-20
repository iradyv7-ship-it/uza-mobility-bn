import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDriverInterestController } from './admin-driver-interest.controller';
import { DriverInterestController } from './driver-interest.controller';
import { DriverInterestService } from './driver-interest.service';

/**
 * The public "I'm interested" front door for the driver journey — deliberately separate
 * from financing's staff-only FundApplication. PrismaModule and AuditModule are @Global.
 */
@Module({
  imports: [AuthModule],
  controllers: [DriverInterestController, AdminDriverInterestController],
  providers: [DriverInterestService],
  exports: [DriverInterestService],
})
export class DriverInterestModule {}
