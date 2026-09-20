import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CandidateJourneyService } from './candidate-journey.service';
import { ListCandidatesDto } from './dto/list-candidates.dto';
import { RegisterCandidateDto } from './dto/register-candidate.dto';

/**
 * The candidate list and the one move that puts somebody in front of a trainer.
 *
 * Staff-only. The class gate is the intake set — the same roles that already hold
 * `fund-applications:manage` on `FundApplicationController`, because the head of UZA
 * Mobility maintaining the candidate list and the officer taking the application are the
 * same desk and it would be strange for one to be able to file the form and not to see the
 * candidate it belongs to.
 *
 * TRAINER is added per-handler on the two READ surfaces a trainer needs, and on nothing
 * else: a trainer must be able to see who has been approved for their class, and must not
 * be able to approve anybody. `RolesGuard` reads the handler's decorator over the class's,
 * so a method-level `@Roles` replaces rather than extends this list — which is why each one
 * restates the full set.
 *
 * `JwtAuthGuard` is global (APP_GUARD in `AuthModule`), so this adds the role gate only.
 */
@ApiTags('candidate-journey')
@ApiBearerAuth('JWT-access')
@Controller('candidate-journey')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN', 'MARKETPLACE_ADMIN', 'INTAKE_OFFICER')
export class CandidateJourneyController {
  constructor(private readonly journeys: CandidateJourneyService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get()
  @ApiOperation({
    summary:
      'The candidate list, each row carrying whether the fund application is on file, signed and submitted',
  })
  list(@Query() dto: ListCandidatesDto) {
    return this.journeys.list(dto);
  }

  @Post()
  @ApiOperation({
    summary:
      'Put a candidate on the list, or correct their entry. Never sets a stage — that is a transition with an event attached.',
  })
  register(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RegisterCandidateDto,
  ) {
    return this.journeys.register(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  /**
   * Declared before `:ref`, because Nest matches routes in declaration order and
   * `training-ready` would otherwise be read as a journey reference.
   */
  @Get('training-ready')
  @Roles(
    'SUPER_ADMIN',
    'FINANCE_ADMIN',
    'MARKETPLACE_ADMIN',
    'INTAKE_OFFICER',
    'TRAINER',
  )
  @ApiOperation({
    summary:
      'The trainer’s list: candidates approved for training, and whether a cohort place actually exists for each',
  })
  trainingReady(@Query('cohortCode') cohortCode?: string) {
    return this.journeys.trainingReady(cohortCode);
  }

  @Get('stage-counts')
  @Roles(
    'SUPER_ADMIN',
    'FINANCE_ADMIN',
    'MARKETPLACE_ADMIN',
    'INTAKE_OFFICER',
    'TRAINER',
  )
  @ApiOperation({
    summary: 'How many candidates sit at each of the forty stages',
  })
  stageCounts() {
    return this.journeys.stageCounts();
  }

  @Get(':ref')
  @ApiOperation({
    summary:
      'One candidate: the journey, its full event history, the application on file, screenings and gaps',
  })
  findOne(@Param('ref') ref: string) {
    return this.journeys.findOne(ref);
  }

  @Get(':ref/screening')
  @ApiOperation({
    summary:
      'What a lender’s own criteria say is still missing. Read-only — nothing here raises or closes a gap.',
  })
  screening(@Param('ref') ref: string) {
    return this.journeys.screening(ref);
  }

  @Post(':ref/confirm-application')
  @ApiOperation({
    summary:
      'Confirm the signed fund application and approve the candidate for training. Idempotent.',
  })
  confirm(@Req() request: AuthenticatedRequest, @Param('ref') ref: string) {
    return this.journeys.confirmAndEnrol(
      this.requireUserId(request),
      ref,
      getRequestAuditContext(request),
    );
  }
}
