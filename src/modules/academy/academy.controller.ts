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
import { AcademyService } from './academy.service';
import { EnrolDto } from './dto/enrol.dto';
import { RecordAssessmentDto } from './dto/record-assessment.dto';
import { RecordAttendanceDto } from './dto/record-attendance.dto';

/**
 * The trainer's surface. Reading a participant's training back as evidence is a lender
 * concern and lives on `LenderController` (`GET /financing/lenders/:key/loans/:loanId/training`),
 * behind the same consent gate as inspections and savings.
 */
@ApiTags('academy')
@ApiBearerAuth('JWT-access')
@Controller('academy')
@UseGuards(RolesGuard)
@Roles('TRAINER', 'FINANCE_ADMIN', 'SUPER_ADMIN')
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get('modules')
  @ApiOperation({ summary: 'The curriculum, in delivery order' })
  modules() {
    return this.academy.listModules();
  }

  @Post('enrolments')
  @ApiOperation({ summary: 'Enrol a participant, by UZA ID, into a cohort' })
  enrol(@Req() request: AuthenticatedRequest, @Body() dto: EnrolDto) {
    return this.academy.enrol(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  @Post('attendance')
  @ApiOperation({
    summary: 'Record one module sitting: attended, passed or not',
  })
  attendance(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RecordAttendanceDto,
  ) {
    return this.academy.recordAttendance(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  @Post('assessments')
  @ApiOperation({
    summary:
      'Record an assessment. COMPREHENSION is scored from the six answers; the others take a score.',
  })
  assessment(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RecordAssessmentDto,
  ) {
    return this.academy.recordAssessment(
      this.requireUserId(request),
      dto,
      getRequestAuditContext(request),
    );
  }

  @Get('impact')
  @ApiOperation({
    summary:
      'Delivery, cost, comprehension, and the repayment comparison — computed from records; what is not measured is listed with the reason',
  })
  impact(
    @Query('costPerParticipantHourRwf') rate?: string,
    @Query('rwfPerEur') fx?: string,
  ) {
    const n = (v?: string) => {
      const x = v ? Number(v) : NaN;
      return Number.isFinite(x) && x >= 0 ? x : undefined;
    };
    return this.academy.impact({
      costPerParticipantHourRwf: n(rate),
      rwfPerEur: n(fx),
    });
  }

  @Get('participants/:uzaId')
  @ApiOperation({
    summary: "A participant's full training file with the computed summary",
  })
  participant(@Param('uzaId') uzaId: string) {
    return this.academy.participantFile(uzaId);
  }
}
