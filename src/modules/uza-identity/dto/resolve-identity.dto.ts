import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { KNOWN_IDENTITY_SYSTEMS } from '../uza-identity.rules';

/** Ask who a foreign key belongs to. */
export class ResolveIdentityDto {
  @ApiProperty({
    description: `The system asking. In use today: ${KNOWN_IDENTITY_SYSTEMS.join(', ')}.`,
    example: 'uza-charge',
  })
  @IsString()
  @MinLength(2)
  system!: string;

  @ApiProperty({ description: "That system's own key", example: 'DRV-00412' })
  @IsString()
  @MinLength(1)
  externalId!: string;
}
