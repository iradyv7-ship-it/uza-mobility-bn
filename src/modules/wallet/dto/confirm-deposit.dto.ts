import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Staff matching a driver-recorded deposit to a line on the institution's statement. */
export class ConfirmDepositDto {
  @ApiProperty({
    description: 'The institution’s statement reference for this credit',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  statementRef!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
