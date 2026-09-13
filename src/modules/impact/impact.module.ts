import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminImpactController } from './admin-impact.controller';
import { ImpactService } from './impact.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminImpactController],
  providers: [ImpactService],
  exports: [ImpactService],
})
export class ImpactModule {}
