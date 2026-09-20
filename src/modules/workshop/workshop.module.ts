import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminMechanicsController } from './admin-mechanics.controller';
import { AdminTrainingCoursesController } from './admin-training-courses.controller';
import { InspectionsController } from './inspections.controller';
import { JobCardsController } from './job-cards.controller';
import { MechanicsController } from './mechanics.controller';
import { RescueController } from './rescue.controller';
import { TrainingCoursesController } from './training-courses.controller';
import { UzaIdentityModule } from '../uza-identity/uza-identity.module';
import { WorkshopService } from './workshop.service';

/**
 * Wiring, not new logic. `job-card.state.ts`, `mechanic-pool.ts`, `rescue-dispatch.ts`,
 * `workshop-board.ts` and `workshop-kpi.ts` already existed, fully written and unit-tested
 * (93 tests), with no controller and no database table — see docs/mobility-audit.md for
 * how that was found. This module gives them persistence and the three read endpoints
 * `uza-mobility-fn`'s `(workshop)` route group already calls
 * (`src/lib/api/workshop.ts`): `GET /workshop/job-cards`, `/mechanics`, `/rescue`.
 *
 * `InspectionsController` is the one genuinely new write surface, added deliberately: a
 * mechanic filing a monthly condition report on a loan's financed vehicle is one of the
 * three things UZA Empower gives a lender in exchange for financing at better terms than
 * the vehicle alone would justify (the other two: trained/scored candidates, and daily
 * savings-vs-required-payment data — see LenderService). Reading that history back is a
 * lender concern, so it's exposed on `LenderController`, not here.
 *
 * Every other mutating endpoint (receive a vehicle, authorise work, transition a job card,
 * dispatch a rescue) is still deliberately NOT built — nothing calls those yet, and adding
 * write surface nobody asked for is exactly the kind of scope creep the project's
 * "no fake completion" rule warns against. The state machine, dispatch and KPI functions
 * are all already imported and ready for that follow-up.
 *
 * `UzaIdentityModule` was added in September so the counter can answer "who is this
 * person, in the terms the rest of UZA uses" — `GET /workshop/job-cards/:reference/
 * client-identity`. It is a read dependency only; the workshop resolves a UZA ID and never
 * issues one.
 */
@Module({
  imports: [AuthModule, UzaIdentityModule],
  controllers: [
    JobCardsController,
    MechanicsController,
    RescueController,
    InspectionsController,
    AdminMechanicsController,
    TrainingCoursesController,
    AdminTrainingCoursesController,
  ],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
