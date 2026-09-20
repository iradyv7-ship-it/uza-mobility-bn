import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_OFFER_DAYS } from '../allocation.rules';

/**
 * Promise one specific physical unit to one person.
 *
 * The person is named EITHER by their queue entry (the schema's own key: one place in the
 * line per class per person) OR by their loan, which the service resolves to a queue entry
 * through the borrower's UZA ID. Both are offered because the two surfaces that need this
 * arrive from different directions — the yard works from the queue, finance works from the
 * loan — and neither should have to look the other up by hand.
 */
export class AllocateUnitDto {
  @ApiProperty({ description: 'The ConsignmentUnit to promise' })
  @IsString()
  @MinLength(1)
  unitId!: string;

  @ApiPropertyOptional({
    description:
      'The AllocationQueue entry to promise it to. Give this or loanId, not neither.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  queueId?: string;

  @ApiPropertyOptional({
    description:
      "The approved loan to promise it against. Resolved to the borrower's queue entry for this unit's class.",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  loanId?: string;

  @ApiPropertyOptional({
    description: `How many days the offer holds before it lapses (1-${MAX_OFFER_DAYS})`,
    default: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_OFFER_DAYS)
  offerDays?: number;

  @ApiPropertyOptional({
    description:
      'Required when this allocation is out of readiness order. Stored on the queue entry, with who decided it.',
  })
  @IsOptional()
  @IsString()
  @Length(10, 500)
  priorityReason?: string;
}
