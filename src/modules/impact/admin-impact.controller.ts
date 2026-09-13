import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ImpactService } from './impact.service';

/**
 * The funder/investor read-projections over facts that already live in their own real
 * tables — see ImpactService's own doc comment for why this is not a new ledger table.
 * The bank's own view is deliberately not duplicated here; it already exists, scoped, on
 * LenderController.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-access')
@Controller('admin/impact')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'FINANCE_ADMIN', 'INTAKE_OFFICER')
export class AdminImpactController {
  constructor(private readonly impactService: ImpactService) {}

  @Get('funder')
  @ApiOperation({
    summary:
      'Aggregate, anonymised programme impact — cohorts, trainees, women/youth mix, EVs financed, collateral bridged',
  })
  funder() {
    return this.impactService.funderSummary();
  }

  @Get('investor')
  @ApiOperation({
    summary:
      'The commercial story built from the same facts as the funder view — loan book, garage-network revenue',
  })
  investor() {
    return this.impactService.investorSummary();
  }
}
