import { Module } from '@nestjs/common';
import { AcademyModule } from '../academy/academy.module';
import { AuthModule } from '../auth/auth.module';
import { UzaIdentityModule } from '../uza-identity/uza-identity.module';
import { CandidateJourneyController } from './candidate-journey.controller';
import { CandidateJourneyService } from './candidate-journey.service';

/**
 * `AcademyModule` is imported rather than duplicated. `AcademyService.enrol` was already
 * the entry point for putting somebody in a cohort — what it never had was a caller that
 * decided WHO was eligible. That decision is this module's, and it calls that method
 * instead of writing `Enrolment` itself; two writers of one table would disagree within a
 * month, which is the reason migration 13 extended `Cohort` rather than adding a second one.
 *
 * Exported because the impact and bank-file surfaces both read journey stages today by
 * querying Prisma directly, and should eventually ask this service instead — one place that
 * knows what "approved for training" means.
 */
@Module({
  imports: [AuthModule, AcademyModule, UzaIdentityModule],
  controllers: [CandidateJourneyController],
  providers: [CandidateJourneyService],
  exports: [CandidateJourneyService],
})
export class CandidateJourneyModule {}
