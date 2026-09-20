import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * The driver's answer to a promise, recorded by the officer who took it.
 *
 * `outcomeNote` is optional on an acceptance and required on a decline — a make nobody
 * accepts is a sourcing error, not a customer problem, and that can only be learned if the
 * reason is written down. The requirement is enforced in the service, not here, because
 * which verb was used is not visible to a DTO.
 */
export class RespondAllocationDto {
  @ApiPropertyOptional({
    description: 'Why it was declined, or any note on the acceptance',
  })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  outcomeNote?: string;
}
