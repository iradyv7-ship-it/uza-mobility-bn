import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto';

/**
 * Every field amendable except the code, which is the stable handle other records quote.
 * Renaming a supplier is ordinary; re-coding one silently orphans references, so it is not
 * offered here.
 */
export class UpdateSupplierDto extends PartialType(
  OmitType(CreateSupplierDto, ['code'] as const),
) {}
