import {
  Body,
  Controller,
  Get,
  NotFoundException,
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
import { LinkIdentityDto } from './dto/link-identity.dto';
import { ResolveIdentityDto } from './dto/resolve-identity.dto';
import { UzaIdentityService } from './uza-identity.service';

/**
 * The identity desk: look a person up by their UZA ID, or by the key another system holds.
 *
 * Staff-only, and read access is deliberately wide. A mechanic at the counter with a
 * customer in front of them is the whole point of the August migration — "the ID can be
 * recoverable when the client visits the garage" — so MECHANIC and WORKSHOP_ADMIN can read
 * here, and TRAINER can too, because the academy addresses participants by UZA ID.
 *
 * Writing a link is narrower. A link is a claim that two records are the same human being,
 * and getting it wrong merges two people's files.
 *
 * `JwtAuthGuard` is global (APP_GUARD in `AuthModule`), so this adds the role gate only.
 */
@ApiTags('identity')
@ApiBearerAuth('JWT-access')
@Controller('identity')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'INTAKE_OFFICER', 'WORKSHOP_ADMIN')
export class UzaIdentityController {
  constructor(private readonly identity: UzaIdentityService) {}

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get('resolve')
  @Roles(
    'SUPER_ADMIN',
    'INTAKE_OFFICER',
    'WORKSHOP_ADMIN',
    'MECHANIC',
    'TRAINER',
    'FINANCE_ADMIN',
  )
  @ApiOperation({
    summary:
      "Who does this foreign key belong to? Returns the UZA ID behind another system's own id",
  })
  async resolve(@Query() dto: ResolveIdentityDto) {
    const found = await this.identity.resolve(dto.system, dto.externalId);
    if (!found) {
      throw new NotFoundException(
        `Nothing in UZA is linked to ${dto.system}/${dto.externalId}.`,
      );
    }
    return found;
  }

  @Get('people/:uzaId')
  @Roles(
    'SUPER_ADMIN',
    'INTAKE_OFFICER',
    'WORKSHOP_ADMIN',
    'MECHANIC',
    'TRAINER',
    'FINANCE_ADMIN',
  )
  @ApiOperation({
    summary: 'One person by UZA ID, with every external key pointing at them',
  })
  person(@Param('uzaId') uzaId: string) {
    return this.identity.linksFor(uzaId);
  }

  @Post('links')
  @ApiOperation({
    summary:
      "Record that another system's key is this person. Idempotent; refuses to re-point an existing key.",
  })
  link(@Req() request: AuthenticatedRequest, @Body() dto: LinkIdentityDto) {
    return this.identity.link(
      {
        uzaId: dto.uzaId,
        system: dto.system,
        externalId: dto.externalId,
        linkedByUserId: this.requireUserId(request),
      },
      getRequestAuditContext(request),
    );
  }

  @Post('users/:userId/uza-id')
  @ApiOperation({
    summary:
      'Issue this account its permanent UZA ID, or return the one it already has',
  })
  ensure(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.identity.ensureForUser(
      userId,
      this.requireUserId(request),
      getRequestAuditContext(request),
    );
  }
}
