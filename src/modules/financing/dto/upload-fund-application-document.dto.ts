import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const FUND_APPLICATION_DOCUMENT_KINDS = [
  'SIGNED_FORM',
  'NATIONAL_ID',
  'DRIVING_LICENCE',
  'PROOF_OF_SAVINGS',
  'OTHER',
] as const;
export type FundApplicationDocumentKindDto =
  (typeof FUND_APPLICATION_DOCUMENT_KINDS)[number];

/**
 * Multipart body accompanying the file (`file` field). The file is what is being filed;
 * these two fields say what it is and, when it replaces an earlier file, why.
 */
export class UploadFundApplicationDocumentDto {
  @ApiProperty({
    enum: FUND_APPLICATION_DOCUMENT_KINDS,
    example: 'SIGNED_FORM',
  })
  @IsIn(FUND_APPLICATION_DOCUMENT_KINDS)
  kind!: FundApplicationDocumentKindDto;

  @ApiPropertyOptional({
    description:
      'Required when this file replaces an earlier one of the same kind — say why (wrong pages, unreadable scan). The earlier file is kept.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
