import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class ChangeTenorDto {
  @ApiProperty({ example: 60, description: 'The new tenor, in months.' })
  @IsInt()
  @IsPositive()
  newTenorMonths!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
