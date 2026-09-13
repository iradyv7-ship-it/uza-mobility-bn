import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrainingCourseSource, WorkCategory } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

/**
 * One entry in the technician-training catalog — Mobility Ecosystem Blueprint, Section
 * 05: "an agent continuously pulls available technician training... into a structured
 * catalog each certified garage's portal surfaces to its own technicians." This DTO is
 * the manual-entry path; a scouting agent populating this automatically is real,
 * separate follow-up work, not simulated with invented course titles here.
 */
export class CreateTrainingCourseDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  title!: string;

  @ApiProperty({ example: 'BYD Auto Academy' })
  @IsString()
  @MinLength(2)
  provider!: string;

  @ApiProperty({ enum: TrainingCourseSource })
  @IsEnum(TrainingCourseSource)
  source!: TrainingCourseSource;

  @ApiProperty({ example: 'zh, with English subtitles' })
  @IsString()
  language!: string;

  @ApiProperty({ enum: WorkCategory })
  @IsEnum(WorkCategory)
  category!: WorkCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
