import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** The driver's default split of a day's money. Must sum to 100. */
export class SetSplitDto {
  @ApiProperty({ example: 60 }) @IsInt() @Min(0) @Max(100) LOAN!: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(0) @Max(100) MAINTENANCE!: number;
  @ApiProperty({ example: 15 }) @IsInt() @Min(0) @Max(100) CHARGING!: number;
  @ApiProperty({ example: 5 }) @IsInt() @Min(0) @Max(100) INSURANCE!: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(0) @Max(100) PERSONAL!: number;
}
