import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupplierOfferDocumentKind } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import {
  gridFsFindByFilename,
  gridFsOpenDownloadStream,
  gridFsUploadBuffer,
} from '../../common/uploads/gridfs.util';
import { MongoService } from '../../mongo/mongo.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../../users/users.types';
import type { UploadSupplierOfferDocumentDto } from './dto/upload-supplier-offer-document.dto';
import {
  assertOwnSupplierRecord,
  isSupplyStaff,
  SUPPLIER_REFUSAL,
} from './supplier-access';
import { SuppliersService } from './suppliers.service';

/**
 * The photographs and papers behind an offer.
 *
 * Identical discipline to `FundApplicationDocumentsService`, and deliberately so — this is
 * the same problem wearing different clothes. What a supplier showed UZA before a price
 * was agreed is the record that settles a later argument about condition, so:
 *
 *  1. Append-only. No update, no delete. A wrong file is superseded by a new row naming
 *     the one it replaces; both stay. The table carries a trigger that refuses UPDATE and
 *     DELETE for any role.
 *  2. Engraved. Every row carries the filer's user id, UZA ID and name as they were at the
 *     moment of filing, and a SHA-256 of the exact bytes.
 *  3. Private. The bytes live in the private GridFS bucket that no public route serves,
 *     and are read only through `stream()`, which knows who is asking.
 *
 * One difference from the fund-application version, and it is not an oversight: PHOTO is
 * expected to arrive many times per offer, so a second photograph is an addition, not a
 * supersession. A second INSPECTION_REPORT is a supersession and needs a reason.
 */
@Injectable()
export class SupplierOfferDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Who is asking, and which offers they may touch.
   *
   * Staff may file against any offer — an inspection report UZA commissioned belongs on
   * the offer it was commissioned for. A supplier user may touch their own offers only,
   * resolved from their grant and never from a parameter.
   */
  private async filer(
    offerId: string,
    user: JwtUserPayload | undefined,
  ): Promise<{
    me: { id: string; uzaId: string | null; name: string };
    offer: { id: string; ref: string; supplierId: string; status: string };
  }> {
    if (!user?.sub) throw new UnauthorizedException();

    const offer = await this.prisma.supplierOffer.findUnique({
      where: { id: offerId },
      select: { id: true, ref: true, supplierId: true, status: true },
    });
    if (!offer) throw new NotFoundException(SUPPLIER_REFUSAL);

    if (!isSupplyStaff(user.roles)) {
      const supplierId = await this.suppliers.resolveSupplierIdFor(user);
      assertOwnSupplierRecord(supplierId, offer.supplierId);
    }

    const row = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { id: true, uzaId: true, firstName: true, lastName: true },
    });
    if (!row) throw new UnauthorizedException();

    return {
      me: {
        id: row.id,
        uzaId: row.uzaId,
        name: `${row.firstName} ${row.lastName}`.trim(),
      },
      offer,
    };
  }

  async upload(
    offerId: string,
    file: Express.Multer.File | undefined,
    dto: UploadSupplierOfferDocumentDto,
    user: JwtUserPayload | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A file is required (field: file).');
    }
    const { me, offer } = await this.filer(offerId, user);

    // Supersession applies to the single-instance kinds only. Many photographs of one
    // vehicle is the normal case and must not be made to look like a correction.
    const supersedable = dto.kind !== SupplierOfferDocumentKind.PHOTO;
    const previous = supersedable
      ? await this.prisma.supplierOfferDocument.findFirst({
          where: { offerId, kind: dto.kind, supersededBy: null },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true },
        })
      : null;

    if (previous && !dto.note?.trim()) {
      throw new BadRequestException(
        `A ${dto.kind} is already on this offer. Filing another one is allowed, but say why in "note" — the earlier file is kept and the reason is part of the record.`,
      );
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const ext = (file.originalname.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const fileRef = `supplier-offers/${offerId}/${dto.kind.toLowerCase()}-${randomUUID()}.${ext || 'bin'}`;

    await gridFsUploadBuffer(
      this.mongo.getPrivateDocumentsBucket(),
      fileRef,
      file.buffer,
      { contentType: file.mimetype, originalName: file.originalname },
    );

    const doc = await this.prisma.supplierOfferDocument.create({
      data: {
        offerId,
        kind: dto.kind,
        fileRef,
        originalName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        uploadedByUserId: me.id,
        uploadedByUzaId: me.uzaId,
        uploadedByName: me.name,
        note: dto.note?.trim() || null,
        supersedesId: previous?.id ?? null,
      },
    });

    await this.audit.record({
      userId: me.id,
      action: 'supplier-offer:document-filed',
      entity: 'SupplierOffer',
      entityId: offerId,
      metadata: {
        documentId: doc.id,
        offerRef: offer.ref,
        kind: doc.kind,
        sha256,
        sizeBytes: file.size,
        originalName: doc.originalName,
        filedBy: { userId: me.id, uzaId: me.uzaId, name: me.name },
        supersedesId: previous?.id ?? null,
      },
    });

    return this.present(doc);
  }

  async list(offerId: string, user: JwtUserPayload | undefined) {
    await this.filer(offerId, user);
    const rows = await this.prisma.supplierOfferDocument.findMany({
      where: { offerId },
      orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }],
    });
    return rows.map((row) => this.present(row));
  }

  /** Stream the bytes to a caller entitled to this offer — never by URL alone. Every read is logged. */
  async stream(
    offerId: string,
    documentId: string,
    user: JwtUserPayload | undefined,
    res: Response,
  ) {
    const { me } = await this.filer(offerId, user);

    const doc = await this.prisma.supplierOfferDocument.findFirst({
      where: { id: documentId, offerId },
    });
    if (!doc) throw new NotFoundException(SUPPLIER_REFUSAL);

    const bucket = this.mongo.getPrivateDocumentsBucket();
    const stored = await gridFsFindByFilename(bucket, doc.fileRef);
    if (!stored) {
      throw new NotFoundException('The file is missing from storage.');
    }

    await this.audit.record({
      userId: me.id,
      action: 'supplier-offer:document-read',
      entity: 'SupplierOffer',
      entityId: offerId,
      metadata: { documentId: doc.id, kind: doc.kind, readBy: me },
    });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${doc.originalName.replace(/["\r\n]/g, '')}"`,
    );
    await new Promise<void>((resolve, reject) => {
      const download = gridFsOpenDownloadStream(bucket, stored);
      download.on('error', reject);
      res.on('finish', resolve);
      download.pipe(res);
    });
  }

  private present(d: {
    id: string;
    kind: SupplierOfferDocumentKind;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedByUserId: string;
    uploadedByUzaId: string | null;
    uploadedByName: string;
    uploadedAt: Date;
    note: string | null;
    supersedesId: string | null;
  }) {
    return {
      id: d.id,
      kind: d.kind,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      filedBy: {
        userId: d.uploadedByUserId,
        uzaId: d.uploadedByUzaId,
        name: d.uploadedByName,
      },
      filedAt: d.uploadedAt,
      note: d.note,
      supersedesId: d.supersedesId,
    };
  }
}
