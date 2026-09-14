import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminImpactController } from './admin-impact.controller';
import { ImpactService } from './impact.service';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [AuthModule, PlatformSettingsModule],
  controllers: [AdminImpactController],
  providers: [ImpactService],
  exports: [ImpactService],
})
export class ImpactModule {}
