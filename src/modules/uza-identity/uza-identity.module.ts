import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UzaIdentityController } from './uza-identity.controller';
import { UzaIdentityService } from './uza-identity.service';

/**
 * The identity layer, exported because it is meant to be depended on.
 *
 * `WorkshopModule` uses it to put a UZA ID on a job card's customer, and
 * `CandidateJourneyModule` uses it to resolve a candidate before touching their journey.
 * It imports nothing from either, so no module cycle is possible — which is the shape this
 * has to keep if the charging network and anything else built later are to use it too.
 */
@Module({
  imports: [AuthModule],
  controllers: [UzaIdentityController],
  providers: [UzaIdentityService],
  exports: [UzaIdentityService],
})
export class UzaIdentityModule {}
