import {
  Body,
  Controller,
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
import { SupplierOfferKind, SupplierOfferStatus } from '@prisma/client';
import { documentMulterOptions } from '../../common/uploads/multer.config';
import type { AuthenticatedRequest } from '../../users/users.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  DeclineSupplierOfferDto,
  ReviewSupplierOfferDto,
} from './dto/review-supplier-offer.dto';
import { UploadSupplierOfferDocumentDto } from './dto/upload-supplier-offer-document.dto';
import { SUPPLY_STAFF_ROLES } from './supplier-access';
import { SupplierOfferDocumentsService } from './supplier-offer-documents.service';
import { SupplierOffersService } from './supplier-offers.service';

/**
 * The review desk: every supplier's offers in one queue, for UZA sourcing.
 *
 * The mirror image of the portal. Here a supplier id IS a parameter, because staff are the
 * side of the partition that is allowed to look across it. The default listing is the
 * queue that matters — SUBMITTED and UNDER_REVIEW, oldest first, because an offer nobody
 * answered is a supplier who stops sending them.
 */
@ApiTags('suppliers')
@ApiBearerAuth('JWT-access')
@Controller('suppliers/offers')
@UseGuards(RolesGuard)
@Roles(...SUPPLY_STAFF_ROLES)
export class SupplierOffersController {
  constructor(
    private readonly offers: SupplierOffersService,
    private readonly documents: SupplierOfferDocumentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Offers awaiting a decision. Defaults to SUBMITTED + UNDER_REVIEW.',
  })
  @ApiQuery({ name: 'status', required: false, enum: SupplierOfferStatus })
  @ApiQuery({ name: 'kind', required: false, enum: SupplierOfferKind })
  @ApiQuery({ name: 'supplierId', required: false })
  list(
    @Query('status') status?: SupplierOfferStatus,
    @Query('kind') kind?: SupplierOfferKind,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.offers.listForStaff({ status, kind, supplierId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One offer, with its supplier and its evidence' })
  findOne(@Param('id') id: string) {
    return this.offers.findForStaff(id);
  }

  @Post(':id/review')
  @ApiOperation({
    summary:
      'Pick the offer up for review. The supplier sees UNDER_REVIEW; not the note.',
  })
  startReview(
    @Param('id') id: string,
    @Body() dto: ReviewSupplierOfferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.offers.startReview(id, dto, req.user);
  }

  /**
   * Accept. Records the sourcing decision and, optionally, the SupplyOrder this offer
   * became — it does not write the order, because an Addendum has gates of its own.
   */
  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept an offer for conversion into a supply order',
  })
  accept(
    @Param('id') id: string,
    @Body() dto: ReviewSupplierOfferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.offers.accept(id, dto, req.user);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline an offer. A reason is required.' })
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineSupplierOfferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.offers.decline(id, dto, req.user);
  }

  /** Staff file evidence too — an inspection report UZA commissioned belongs on the offer. */
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', documentMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'File evidence against an offer as UZA staff' })
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

  @Get(':id/documents/:documentId/file')
  @ApiOperation({
    summary: 'Stream a filed document. Every read is logged.',
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
