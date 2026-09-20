import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Put a person in the line for a class of vehicle.
 *
 * `readyAt` is when they became genuinely ready — contribution paid, training complete,
 * bank file approved — and NOT when they applied. The schema says so on the column, and it
 * matters: queue order that rewards early enquiry rather than readiness is how a paid-up
 * applicant ends up behind someone who is not. It is required rather than defaulted to now
 * for exactly that reason; whoever enqueues has to state the date they mean.
 */
export class EnqueueDriverDto {
  @ApiProperty({ description: 'The applicant, by UZA ID' })
  @IsString()
  @MinLength(1)
  uzaId!: string;

  @ApiProperty({ description: 'Vehicle class code, e.g. CAR, BIKE, TRUCK' })
  @IsString()
  @MinLength(1)
  classCode!: string;

  @ApiProperty({
    description:
      'When they became ready — contribution paid, training done, file approved. Not when they applied.',
  })
  @IsDateString()
  readyAt!: string;

  @ApiPropertyOptional({
    description: 'A stated preference, recorded not enforced',
  })
  @IsOptional()
  @IsString()
  preferredMake?: string;

  @ApiPropertyOptional({
    description: 'A stated preference, recorded not enforced',
  })
  @IsOptional()
  @IsString()
  preferredModel?: string;
}
