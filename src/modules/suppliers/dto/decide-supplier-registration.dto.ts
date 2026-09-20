import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Approving a supplier does two things at once, and both matter:
 *   1. the Supplier row moves PROSPECT -> ACTIVE, and
 *   2. the registering user's `CounterpartyAccess` grant is written.
 *
 * Until step 2 the account can sign in and see nothing. That is the point of the PROSPECT
 * state: an account exists so the applicant can be corresponded with, and it carries no
 * sight of anything.
 */
export class ApproveSupplierRegistrationDto {
  @ApiPropertyOptional({
    example: 'SUP-MENTO',
    description:
      'The permanent code. Optional — derived from the legal name if omitted.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'code is upper-case letters, digits and hyphens only',
  })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectSupplierRegistrationDto {
  @ApiProperty({
    example: 'No verifiable export licence for the stated country.',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  reason!: string;
}
