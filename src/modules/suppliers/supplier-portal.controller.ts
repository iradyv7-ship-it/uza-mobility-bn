import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SupplierOfferStatus } from '@prisma/client';
import { documentMulterOptions } from '../../common/uploads/multer.config';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SubmitSupplierOfferDto } from './dto/submit-supplier-offer.dto';
import { UploadSupplierOfferDocumentDto } from './dto/upload-supplier-offer-document.dto';
import { SupplierOfferDocumentsService } from './supplier-offer-documents.service';
import { SupplierOffersService } from './supplier-offers.service';
import { SUPPLIER_PORTAL_ROLE, SUPPLY_STAFF_ROLES } from './supplier-access';
import { SuppliersService } from './suppliers.service';

/**
 * The supplier's own portal: "here is what we have."
 *
 * NOT ONE ROUTE HERE TAKES A SUPPLIER ID. The caller's supplier is resolved from their
 * `CounterpartyAccess` grant on every single call, which is what makes the partition
 * structural rather than a filter somebody can forget. The rule this implements is written
 * in `prisma/schema.prisma`:
 *
 *   "SUPPLIER scope -> SupplyOrder WHERE supplierId = theirs. Never FinancingRequest,
 *    never Listing prices, never another supplier's anything."
 *
 * Staff roles are accepted on these routes too, so that somebody can see what a supplier
 * sees when a portal is reported broken — but a staff caller with no grant of their own is
 * refused exactly like anyone else, which is the correct outcome: the way to look at a
 * supplier's offers as staff is the staff controller.
 */
@ApiTags('suppliers')
@ApiBearerAuth('JWT-access')
@Controller('suppliers/portal')
@UseGuards(RolesGuard)
@Roles(SUPPLIER_PORTAL_ROLE, ...SUPPLY_STAFF_ROLES)
export class SupplierPortalController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly offers: SupplierOffersService,
    private readonly documents: SupplierOfferDocumentsService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in supplier’s own company record' })
  me(@Req() req: AuthenticatedRequest) {
    return this.suppliers.myProfile(req.user);
  }

  /**
   * The supplier's own orders — order and money, the only view of a vehicle a supplier
   * ever gets. No listing price, no financing, no other supplier.
   */
  @Get('orders')
  @ApiOperation({ summary: 'The supplier’s own supply orders' })
  orders(@Req() req: AuthenticatedRequest) {
    return this.suppliers.myOrders(req.user);
  }

  @Post('offers')
  @ApiOperation({
    summary:
      'Submit an available option — a vehicle or a line of spare parts. Indicative, not binding.',
  })
  submit(
    @Body() dto: SubmitSupplierOfferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.offers.submit(dto, req.user);
  }

  @Get('offers')
  @ApiOperation({ summary: 'The supplier’s own offers' })
  @ApiQuery({ name: 'status', required: false, enum: SupplierOfferStatus })
  listMine(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: SupplierOfferStatus,
  ) {
    return this.offers.listMine(req.user, status);
  }

  @Get('offers/:id')
  @ApiOperation({ summary: 'One of the supplier’s own offers' })
  findMine(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.offers.findMine(id, req.user);
  }

  @Delete('offers/:id')
  @ApiOperation({
    summary:
      'Withdraw an undecided offer. The row stays; only its status changes.',
  })
  withdraw(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.offers.withdraw(id, req.user);
  }

  /**
   * File a photograph or a paper against an offer.
   *
   * Append-only and engraved, the same as a fund application's documents: the row carries
   * the filer's identity and a SHA-256 of the bytes, the table refuses UPDATE and DELETE
   * at the database, and the bytes live in a private bucket no public route serves.
   */
  @Post('offers/:id/documents')
  @UseInterceptors(FileInterceptor('file', documentMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'File evidence against an offer — photographs above all',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: {
          type: 'string',
          enum: [
            'PHOTO',
            'INSPECTION_REPORT',
            'SPECIFICATION',
            'PROFORMA_INVOICE',
            'OTHER',
          ],
        },
        note: { type: 'string' },
      },
      required: ['file', 'kind'],
    },
  })
  fileDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadSupplierOfferDocumentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents.upload(id, file, dto, req.user);
  }

  @Get('offers/:id/documents')
  @ApiOperation({
    summary: 'Everything filed against the offer, with who filed it',
  })
  listDocuments(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.list(id, req.user);
  }

  @Get('offers/:id/documents/:documentId/file')
  @ApiOperation({
    summary: 'Stream a filed document. Authenticated; every read is logged.',
  })
  streamDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    return this.documents.stream(id, documentId, req.user, res);
  }
}
