import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * One participant, one module, one sitting. `passed` is the trainer's judgement against the
 * module's own assessment (see the curriculum: a lot circuit, a teach-back, a full charge
 * unaided). A failed sitting is recorded too — reassessment is normal, private and unlimited,
 * and the record should show the second attempt as a second attempt.
 */
export class RecordAttendanceDto {
  @ApiProperty({ example: 'UZA-P-2026-000141' })
  @IsString()
  @MinLength(6)
  uzaId!: string;

  @ApiProperty({
    example: '1.0',
    description: 'Module code from the curriculum',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  moduleCode!: string;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  attendedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
