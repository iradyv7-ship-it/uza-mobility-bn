import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleCondition } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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

/**
 * One thing found on the vehicle and what was done about it.
 *
 * This is the shape of the record a lender asked for — "mistakes, correction measures and
 * certificate" — and the shape a garage already keeps on paper. `resolvedAt` distinguishes
 * "we found a brake defect" from "we found and fixed a brake defect", which is the whole
 * difference between a vehicle a bank should worry about and one it should not.
 */
export class InspectionFindingDto {
  @ApiProperty({ example: 'Front brake pads below wear limit' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  item!: string;

  @ApiProperty({ enum: ['MINOR', 'MAJOR', 'SAFETY'] })
  @IsIn(['MINOR', 'MAJOR', 'SAFETY'])
  severity!: 'MINOR' | 'MAJOR' | 'SAFETY';

  @ApiProperty({ example: 'Pads replaced; discs within tolerance' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  correctiveAction!: string;

  @ApiPropertyOptional({
    description: 'When it was fixed. Absent means still open.',
  })
  @IsOptional()
  @IsDateString()
  resolvedAt?: string;
}

export class CreateVehicleInspectionDto {
  @ApiProperty({
    description:
      "The loan whose financed vehicle this inspection covers. A garage finds it via GET /workshop/inspections/vehicle?uzaId=… from the client's UZA ID.",
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
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [InspectionFindingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => InspectionFindingDto)
  findings?: InspectionFindingDto[];

  @ApiPropertyOptional({
    description:
      "The garage's overall verdict. Refused if true while a SAFETY finding is unresolved.",
  })
  @IsOptional()
  @IsBoolean()
  passed?: boolean;

  @ApiPropertyOptional({
    description: "The garage's own certificate reference",
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  certificateRef?: string;

  @ApiPropertyOptional({
    description:
      'When the next inspection is due. Defaults to 30 days from now.',
  })
  @IsOptional()
  @IsDateString()
  nextDueAt?: string;
}
