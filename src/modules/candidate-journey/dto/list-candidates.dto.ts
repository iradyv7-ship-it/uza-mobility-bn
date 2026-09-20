import { ApiPropertyOptional } from '@nestjs/swagger';
import { IntakeSource, JourneyStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListCandidatesDto {
  @ApiPropertyOptional({
    enum: JourneyStage,
    description: 'One of the forty canonical stages',
  })
  @IsOptional()
  @IsEnum(JourneyStage)
  stage?: JourneyStage;

  @ApiPropertyOptional({ enum: IntakeSource })
  @IsOptional()
  @IsEnum(IntakeSource)
  intakeSource?: IntakeSource;

  @ApiPropertyOptional({ description: 'Cohort code, e.g. TT-2026-01' })
  @IsOptional()
  @IsString()
  cohortCode?: string;
}
