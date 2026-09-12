import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateFundApplicationDto } from './dto/create-fund-application.dto';
import { UpdateFundApplicationDto } from './dto/update-fund-application.dto';
import { SignFundApplicationDto } from './dto/sign-fund-application.dto';
import { FundApplicationService } from './fund-application.service';

/**
 * The UZA Empower fund application.
 *
 * Staff-only. A driver does not self-serve this form: the programme is designed for
 * oral-first delivery in Kinyarwanda, so in practice a member of staff sits with the
 * applicant, reads the questions aloud and records the answers — which is what
 * `completionMode: ASSISTED` records.
 *
 * That is a deliberate design choice rather than a limitation, and it is why there is no
 * public route here. When a self-service route is added it belongs in the customer
 * application, and it must still write `completionMode: SELF_SERVICE` so the two are
 * distinguishable in evidence.
 */
@ApiTags('financing')
@ApiBearerAuth('JWT-access')
@Controller('financing/fund-applications')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN', 'MARKETPLACE_ADMIN', 'INTAKE_OFFICER')
export class FundApplicationController {
  constructor(private readonly applications: FundApplicationService) {}

  @Post()
  @ApiOperation({ summary: 'Start an application. Saves as a draft.' })
  create(@Body() dto: CreateFundApplicationDto) {
    return this.applications.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List applications, newest first' })
  list(@Query('cohortId') cohortId?: string, @Query('status') status?: string) {
    return this.applications.list(cohortId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One application' })
  findOne(@Param('id') id: string) {
    return this.applications.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Amend a draft. Refused once the form has been signed.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateFundApplicationDto) {
    return this.applications.update(id, dto);
  }

  /**
   * Sign and submit in one step.
   *
   * Completeness is checked BEFORE the signature is recorded, so an applicant is never
   * asked to sign a form that is then rejected.
   */
  @Post(':id/signature')
  @ApiOperation({ summary: 'Sign and submit the application' })
  sign(@Param('id') id: string, @Body() dto: SignFundApplicationDto) {
    return this.applications.sign(id, dto);
  }

  /**
   * What stands between this applicant and a loan.
   *
   * Returns a list of gaps to close, never a yes or a no. `blockedAtIntake` is true only
   * for a missing licence or missing identity documents.
   */
  @Get(':id/screening')
  @ApiOperation({ summary: 'Eligibility gaps, derived from the answers' })
  screen(
    @Param('id') id: string,
    @Query('requiredContributionRwf') required?: string,
    @Query('vehiclePriceRwf') price?: string,
  ) {
    const num = (v?: string) => {
      const n = v ? Number.parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.applications.screen(id, num(required), num(price));
  }
}
