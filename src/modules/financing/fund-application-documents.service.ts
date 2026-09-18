import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
import type { UploadFundApplicationDocumentDto } from './dto/upload-fund-application-document.dto';

/** Who may file a document against an application: the head of UZA Mobility, finance, or an assigned intake officer. */
const FILING_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'INTAKE_OFFICER'];

/**
 * The signed paper form, and the papers behind it, filed against the application and
 * engraved against the employee who filed them.
 *
 * Three properties, each enforced here and — for the first — in the database itself:
 *
 *  1. Append-only. No update, no delete. A wrong file is superseded by a new row that names
 *     the one it replaces; both remain. The table carries a trigger that refuses UPDATE and
 *     DELETE for any role, so even a database administrator cannot quietly correct history.
 *  2. Engraved. Every row carries the employee's user id, UZA ID and name as they were at the
 *     moment of filing, and a SHA-256 of the exact bytes. The activity log gets a second,
 *     independent record of the same event.
 *  3. Private. The bytes live in a GridFS bucket that no public route serves. They are read
 *     only through `stream()`, which knows who is asking, and every read is logged.
 */
@Injectable()
export class FundApplicationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly audit: AuditService,
  ) {}

  private async filer(user: JwtUserPayload | undefined) {
    if (!user?.sub) throw new UnauthorizedException();
    if (!user.roles.some((r) => FILING_ROLES.includes(r))) {
      throw new ForbiddenException(
        'Only the head of UZA Mobility, finance, or an assigned intake officer may file documents against an application.',
      );
    }
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { id: true, uzaId: true, firstName: true, lastName: true },
    });
    if (!u) throw new UnauthorizedException();
    return {
      id: u.id,
      uzaId: u.uzaId,
      name: `${u.firstName} ${u.lastName}`.trim(),
    };
  }

  async upload(
    applicationId: string,
    file: Express.Multer.File | undefined,
    dto: UploadFundApplicationDocumentDto,
    user: JwtUserPayload | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A file is required (field: file).');
    }
    const me = await this.filer(user);

    const application = await this.prisma.fundApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, ref: true, signedAt: true },
    });
    if (!application) throw new NotFoundException('No such application.');

    // The signed form is a scan of a signed paper. Filing one before the applicant has
    // signed is a sequencing error worth stopping: the signature event (POST :id/signature)
    // is what turns a draft into an application.
    if (dto.kind === 'SIGNED_FORM' && !application.signedAt) {
      throw new BadRequestException(
        'Record the signature first (POST /financing/fund-applications/:id/signature); then file the signed form.',
      );
    }

    const previous = await this.prisma.fundApplicationDocument.findFirst({
      where: {
        fundApplicationId: applicationId,
        kind: dto.kind,
        supersededBy: null,
      },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true },
    });
    if (previous && !dto.note?.trim()) {
      throw new BadRequestException(
        `A ${dto.kind} is already on file. Filing another one is allowed, but say why in "note" — the earlier file is kept and the reason is part of the record.`,
      );
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const ext = (file.originalname.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const fileRef = `fund-applications/${applicationId}/${dto.kind.toLowerCase()}-${randomUUID()}.${ext || 'bin'}`;

    await gridFsUploadBuffer(
      this.mongo.getPrivateDocumentsBucket(),
      fileRef,
      file.buffer,
      { contentType: file.mimetype, originalName: file.originalname },
    );

    const doc = await this.prisma.fundApplicationDocument.create({
      data: {
        fundApplicationId: applicationId,
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
      action: 'FUND_APPLICATION_DOCUMENT_FILED',
      entity: 'fund_application',
      entityId: applicationId,
      metadata: {
        documentId: doc.id,
        kind: doc.kind,
        sha256,
        sizeBytes: file.size,
        originalName: doc.originalName,
        filedBy: { userId: me.id, uzaId: me.uzaId, name: me.name },
        supersedesId: previous?.id ?? null,
        applicationRef: application.ref,
      },
    });

    return this.present(doc);
  }

  async list(applicationId: string, user: JwtUserPayload | undefined) {
    await this.filer(user);
    const rows = await this.prisma.fundApplicationDocument.findMany({
      where: { fundApplicationId: applicationId },
      orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }],
    });
    return rows.map((r) => this.present(r));
  }

  /** Stream the bytes to a caller who is allowed to file — never by URL alone. Every read is logged. */
  async stream(
    applicationId: string,
    documentId: string,
    user: JwtUserPayload | undefined,
    res: Response,
  ) {
    const me = await this.filer(user);
    const doc = await this.prisma.fundApplicationDocument.findFirst({
      where: { id: documentId, fundApplicationId: applicationId },
    });
    if (!doc) throw new NotFoundException('No such document.');

    const bucket = this.mongo.getPrivateDocumentsBucket();
    const file = await gridFsFindByFilename(bucket, doc.fileRef);
    if (!file) throw new NotFoundException('The file is missing from storage.');

    await this.audit.record({
      userId: me.id,
      action: 'FUND_APPLICATION_DOCUMENT_READ',
      entity: 'fund_application',
      entityId: applicationId,
      metadata: { documentId: doc.id, kind: doc.kind, readBy: me },
    });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${doc.originalName.replace(/["\r\n]/g, '')}"`,
    );
    await new Promise<void>((resolve, reject) => {
      const stream = gridFsOpenDownloadStream(bucket, file);
      stream.on('error', reject);
      res.on('finish', resolve);
      stream.pipe(res);
    });
  }

  private present(d: {
    id: string;
    kind: string;
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
