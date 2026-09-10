import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Signing an application.
 *
 * Separate from creating it, because a signature is an event with a time rather than a
 * field on a form. The image lives in GridFS and only its reference is stored: a Postgres
 * row is the wrong home for a photograph, and a signature is evidence that should be
 * retrievable independently of the row pointing at it.
 */
export class SignFundApplicationDto {
  @ApiProperty({
    description: 'GridFS reference to the captured signature image',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  signatureRef!: string;

  @ApiPropertyOptional({
    description:
      'Witness present at signing. Recorded for an assisted completion, where a staff member read the form aloud.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  witnessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  witnessRef?: string;
}
