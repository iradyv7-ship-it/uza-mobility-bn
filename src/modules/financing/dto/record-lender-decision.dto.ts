import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LenderDecisionOutcome } from '@prisma/client';
import {
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RecordLenderDecisionDto {
  @ApiProperty({ enum: LenderDecisionOutcome })
  @IsEnum(LenderDecisionOutcome)
  outcome!: LenderDecisionOutcome;

  @ApiProperty({
    description: 'Why — a decision without a reason is not a decision.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reasons!: string;

  @ApiPropertyOptional({
    description: 'Required when outcome is CONDITIONAL.',
  })
  @ValidateIf(
    (dto: RecordLenderDecisionDto) =>
      Boolean(dto.conditions) ||
      dto.outcome === LenderDecisionOutcome.CONDITIONAL,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  conditions?: string;
}
