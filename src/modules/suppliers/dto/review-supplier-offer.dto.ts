import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Move an offer to UNDER_REVIEW, or accept it. A note is optional; a reason is not. */
export class ReviewSupplierOfferDto {
  @ApiPropertyOptional({
    description: 'Internal note. Not shown to the supplier.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'On acceptance, the SupplyOrder this offer became — the only bridge between the two records.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  convertedSupplyOrderId?: string;
}

/**
 * Declining is the one review action that requires a reason.
 *
 * A supplier who is told "declined" and nothing else submits the same unit again next
 * week, and staff review it again. The reason is the whole value of the decision.
 */
export class DeclineSupplierOfferDto {
  @ApiProperty({
    example: 'Battery SoH below the 85% threshold for this programme.',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  reason!: string;
}
