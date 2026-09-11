import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import { RequirePermission } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { BankFileGeneratorService } from './bank-file-generator.service';
import { BankPackageService } from './bank-package.service';

@ApiTags('bank-files')
@ApiBearerAuth('JWT-access')
@UseGuards(PermissionsGuard)
@Controller('bank-files')
export class BankFilesController {
  constructor(
    private readonly generator: BankFileGeneratorService,
    private readonly bankPackage: BankPackageService,
  ) {}

  @Post(':ref/sync-requirements')
  @RequirePermission('financing:send-to-bank')
  @ApiOperation({
    summary:
      "Add any of this file's lender's requirements it does not have yet",
    description:
      'Reads the lender’s own document requirements if configured, otherwise the UZA ' +
      'default eleven-item checklist, and adds whichever items this file is missing. ' +
      'Never removes an existing item.',
  })
  syncRequirements(@Param('ref') ref: string) {
    return this.generator.syncRequiredItems(ref);
  }

  @Get('bottleneck')
  @RequirePermission('financing:read')
  @ApiOperation({
    summary: 'Where the pipeline is stuck',
    description:
      'Splits outstanding items by source. `uploaded` and `external` are somebody\u2019s job today; ' +
      '`generated` items that will not generate are a missing upstream fact, and chasing an officer ' +
      'for those wastes everyone\u2019s time.',
  })
  bottleneck() {
    return this.generator.bottleneck();
  }

  @Post('generate')
  @RequirePermission('financing:send-to-bank')
  @ApiOperation({
    summary: 'Generate every generatable item across all open files',
    description:
      'Idempotent. Items already present are untouched, and nothing that needs a human upload or an ' +
      'external fetch is ever marked present \u2014 pretending a national ID exists is worse than knowing it does not.',
  })
  generateAll() {
    return this.generator.generateForAll();
  }

  @Post(':ref/generate')
  @RequirePermission('financing:send-to-bank')
  @ApiOperation({ summary: 'Generate what can be generated for one file' })
  generateOne(@Param('ref') ref: string) {
    return this.generator.generateForFile(ref);
  }

  @Post(':ref/package')
  @RequirePermission('financing:send-to-bank')
  @ApiOperation({
    summary: 'Publish an actual, versioned PDF of this bank file',
    description:
      'Renders the current state of the file to PDF, refuses when a mandatory item is ' +
      'unresolved, and archives the result with a SHA-256 checksum and an incrementing ' +
      'version. Never mutates the file’s own items — publishing observes the file.',
  })
  publishPackage(
    @Req() request: AuthenticatedRequest,
    @Param('ref') ref: string,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();

    return this.bankPackage.publish(
      ref,
      userId,
      getRequestAuditContext(request),
    );
  }

  @Get(':ref/packages')
  @RequirePermission('financing:read')
  @ApiOperation({
    summary: 'Every published version of this bank file’s package',
  })
  listPackages(@Param('ref') ref: string) {
    return this.bankPackage.listVersions(ref);
  }
}
