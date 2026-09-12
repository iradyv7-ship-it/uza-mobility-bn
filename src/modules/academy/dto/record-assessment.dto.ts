import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @ApiProperty({ example: 'LIT-Q1' })
  @IsString()
  @MinLength(3)
  @MaxLength(16)
  questionCode!: string;

  @ApiProperty()
  @IsBoolean()
  correct!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/**
 * An assessment. For COMPREHENSION the score is COMPUTED from the six answers and a typed
 * `scorePct` is refused — a trainer who wants to record 83% records five correct answers.
 * For ROAD_CRAFT and EV_CARE, which are observed rather than questioned, `scorePct` is given.
 *
 * `recordingUrl` is the oral evidence; it attaches to the bank file and the retention policy
 * applies. `retestOfId` links a day-30 or day-90 re-test to the assessment it supersedes so
 * the trend is computable.
 */
export class RecordAssessmentDto {
  @ApiProperty({ example: 'UZA-P-2026-000141' })
  @IsString()
  @MinLength(6)
  uzaId!: string;

  @ApiProperty({ enum: ['COMPREHENSION', 'ROAD_CRAFT', 'EV_CARE'] })
  @IsIn(['COMPREHENSION', 'ROAD_CRAFT', 'EV_CARE'])
  kind!: 'COMPREHENSION' | 'ROAD_CRAFT' | 'EV_CARE';

  @ApiPropertyOptional({
    description: 'ROAD_CRAFT / EV_CARE only. Refused for COMPREHENSION.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  scorePct?: number;

  @ApiPropertyOptional({
    type: [AnswerDto],
    description: 'COMPREHENSION: exactly the six questions',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];

  @ApiPropertyOptional({ default: 'rw' })
  @IsOptional()
  @IsIn(['rw', 'en', 'fr'])
  language?: 'rw' | 'en' | 'fr';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  oral?: boolean;

  @ApiPropertyOptional({
    description: 'GridFS or storage reference of the recording',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  recordingUrl?: string;

  @ApiPropertyOptional({
    description: 'The assessment this re-test supersedes',
  })
  @IsOptional()
  @IsString()
  retestOfId?: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  assessedAt?: string;
}
