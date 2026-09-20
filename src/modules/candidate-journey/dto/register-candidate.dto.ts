import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntakeSource } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Put a candidate on the list, or correct an entry already on it.
 *
 * There is deliberately no `stage` field. Moving a candidate is a transition with a
 * `JourneyEvent` attached and it happens through `POST :ref/confirm-application`; letting
 * the list screen set a stage directly would produce journeys nobody can account for, which
 * is the whole failure migration 13's append-only event log exists to prevent.
 */
export class RegisterCandidateDto {
  @ApiProperty({
    description: 'The candidate, by UZA ID',
    example: 'UZA-P-2026-000042',
  })
  @IsString()
  @MinLength(1)
  uzaId!: string;

  @ApiProperty({
    enum: IntakeSource,
    description:
      'Where they came from. LENDER_REFERRAL for somebody a bank screened and set aside; RETURNING for somebody who exited a previous cohort and came back.',
  })
  @IsEnum(IntakeSource)
  intakeSource!: IntakeSource;

  @ApiPropertyOptional({
    description:
      'Which lender referred them. Recorded because a lender wants to see how its OWN referrals fared.',
    example: 'LOLC Unguka',
  })
  @IsOptional()
  @IsString()
  referredBy?: string;

  @ApiPropertyOptional({ description: 'When the referral was made' })
  @IsOptional()
  @IsDateString()
  referredOn?: string;

  @ApiPropertyOptional({
    description:
      'The training group, by code. May be assigned later — a candidate can be registered before a cohort exists.',
    example: 'TT-2026-01',
  })
  @IsOptional()
  @IsString()
  cohortCode?: string;
}
