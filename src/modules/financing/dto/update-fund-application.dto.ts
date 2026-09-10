import { PartialType } from '@nestjs/swagger';
import { CreateFundApplicationDto } from './create-fund-application.dto';

/**
 * Editing an application already on file.
 *
 * Every field is optional, including the ones that are mandatory at creation. A form is
 * filled in over several sittings — a driver comes back with a licence expiry, or ticks
 * the consent box a day after giving their answers — and each of those is a PATCH
 * carrying one field. Reusing the create DTO here would force the whole form to be
 * resent to change a single tickbox, which is how a partial save silently overwrites
 * something with a stale value.
 *
 * What may be changed at all, and by whom, is decided in the service: a signed
 * application is not editable.
 */
export class UpdateFundApplicationDto extends PartialType(
  CreateFundApplicationDto,
) {}
