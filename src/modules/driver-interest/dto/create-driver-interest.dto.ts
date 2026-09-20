import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { DriverInterestVehicleType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateDriverInterestDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  fullName!: string;

  @ApiProperty()
  @IsString()
  @Length(6, 30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  district!: string;

  @ApiPropertyOptional({ enum: DriverInterestVehicleType })
  @IsOptional()
  @IsEnum(DriverInterestVehicleType)
  preferredVehicleType?: DriverInterestVehicleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
