import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';

/**
 * Exported, because the bank file pipeline reads allocations today by querying Prisma
 * directly (`bank-file-generator.service.ts`) and should eventually ask this service
 * instead — one place that knows what "a live allocation" means.
 */
@Module({
  imports: [AuthModule],
  controllers: [AllocationController],
  providers: [AllocationService],
  exports: [AllocationService],
})
export class AllocationModule {}
