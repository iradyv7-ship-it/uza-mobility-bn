import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { KNOWN_IDENTITY_SYSTEMS } from '../uza-identity.rules';

/**
 * Record that another system's own key belongs to this person.
 *
 * The shape is deliberately the other system's: it sends what it holds (its key) and the
 * UZA ID it believes that key belongs to. It does not need, and is not given, the internal
 * user cuid — the foreign key on `identity_links` points at the public identifier for
 * exactly that reason.
 */
export class LinkIdentityDto {
  @ApiProperty({
    description: 'The person, by UZA ID',
    example: 'UZA-P-2026-000042',
  })
  @IsString()
  @MinLength(1)
  uzaId!: string;

  @ApiProperty({
    description: `The system holding the key. Lowercase kebab. In use today: ${KNOWN_IDENTITY_SYSTEMS.join(', ')} — the list is not closed.`,
    example: 'garage',
  })
  @IsString()
  @MinLength(2)
  system!: string;

  @ApiProperty({
    description: "That system's own primary key for this person",
    example: 'CUST-00871',
  })
  @IsString()
  @MinLength(1)
  externalId!: string;
}
