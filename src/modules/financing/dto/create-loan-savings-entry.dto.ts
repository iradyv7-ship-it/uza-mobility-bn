import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, Min } from 'class-validator';

export class CreateLoanSavingsEntryDto {
  @ApiProperty({
    description: 'The calendar day this deposit covers, YYYY-MM-DD',
  })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  depositedRwf!: number;
}
