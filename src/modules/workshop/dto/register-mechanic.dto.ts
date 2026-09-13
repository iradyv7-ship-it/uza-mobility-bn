import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MechanicEngagement,
  MechanicLevel,
  WorkCategory,
} from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Onboarding a garage/workshop partner — the one gap in the workshop module that had no
 * code path at all (see docs/mobility-audit.md): a Mechanic row could never be created,
 * so nobody could actually record an inspection even after being granted the
 * WORKSHOP_ADMIN/MECHANIC role. The role controls portal access; this is the partner
 * record itself.
 */
export class RegisterMechanicDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: MechanicEngagement })
  @IsEnum(MechanicEngagement)
  engagement!: MechanicEngagement;

  @ApiProperty({ enum: MechanicLevel })
  @IsEnum(MechanicLevel)
  level!: MechanicLevel;

  @ApiProperty({ type: [String], enum: WorkCategory })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WorkCategory, { each: true })
  certifiedFor!: WorkCategory[];

  @ApiProperty({ description: "When this partner's certification expires." })
  @IsDateString()
  certifiedUntil!: string;

  @ApiPropertyOptional({
    description:
      'Link to an existing UZA account (e.g. one just granted WORKSHOP_ADMIN/MECHANIC) — set only for an EMPLOYED technician who also logs in.',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
