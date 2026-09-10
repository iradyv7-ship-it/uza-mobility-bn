import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleCondition } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVehicleInspectionDto {
  @ApiProperty({
    description: 'The loan whose financed vehicle this inspection covers',
  })
  @IsString()
  loanId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  mileageKm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryHealthPct?: number;

  @ApiProperty({ enum: VehicleCondition })
  @IsEnum(VehicleCondition)
  condition!: VehicleCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
