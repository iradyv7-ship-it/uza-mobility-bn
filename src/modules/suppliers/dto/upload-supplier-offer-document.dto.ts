import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierOfferDocumentKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** Evidence filed against an offer. Photographs above all. */
export class UploadSupplierOfferDocumentDto {
  @ApiProperty({ enum: SupplierOfferDocumentKind })
  @IsEnum(SupplierOfferDocumentKind)
  kind!: SupplierOfferDocumentKind;

  @ApiPropertyOptional({
    description:
      'Required when a file of this kind is already on the offer — the earlier file is kept and this says why it was replaced.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
