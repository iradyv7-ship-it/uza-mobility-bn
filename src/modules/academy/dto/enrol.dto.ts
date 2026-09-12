import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Enrol a participant, by the UZA ID on their card, into a cohort. */
export class EnrolDto {
  @ApiProperty({ example: 'UZA-P-2026-000141' })
  @IsString()
  @MinLength(6)
  uzaId!: string;

  @ApiProperty({ description: 'Cohort code, e.g. TT-2026-01' })
  @IsString()
  @MinLength(3)
  cohortCode!: string;
}
