import { createHash } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { BankPackagePdfService } from './bank-package-pdf.service';
import { BankPackageStorageService } from './bank-package-storage.service';
import { validateBankFileForPublish } from './bank-package-validation';

/**
 * Turns a bank file's live data into an actual, versioned, checksummed PDF.
 *
 * `BankFileGeneratorService` (the sibling this lives next to) only ever flips `present`
 * on rows — it has never produced a document a human could hand to a bank. This is that
 * missing half: `publish()` renders the current state of the file, refuses when a
 * mandatory item is unresolved (see `bank-package-validation.ts`), archives the PDF with
 * a SHA-256 checksum and an incrementing version, and writes an audit-log row on every
 * publish. Nothing here mutates `BankFileItem` — publishing observes the file, it does
 * not change it.
 */
@Injectable()
export class BankPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: BankPackagePdfService,
    private readonly storage: BankPackageStorageService,
    private readonly auditService: AuditService,
  ) {}

  async publish(
    bankFileRef: string,
    publishedByUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const file = await this.prisma.bankFile.findUnique({
      where: { ref: bankFileRef },
      include: { items: true, events: { orderBy: { at: 'desc' }, take: 25 } },
    });
    if (!file) {
      throw new NotFoundException(`bank file ${bankFileRef} not found`);
    }

    const issues = validateBankFileForPublish(file.items);
    if (issues.length > 0) {
      throw new BadRequestException({
        message: `This package cannot be published yet: ${issues.length} item(s) unresolved.`,
        issues,
      });
    }

    const [applicant, publisher, lastVersion] = await Promise.all([
      this.prisma.user.findFirst({
        where: { uzaId: file.uzaId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.user.findUnique({
        where: { id: publishedByUserId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.bankPackage.findFirst({
        where: { bankFileId: file.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
    ]);

    const version = (lastVersion?.version ?? 0) + 1;
    const applicantName = applicant
      ? `${applicant.firstName} ${applicant.lastName}`.trim()
      : file.uzaId;
    const generatedByName = publisher
      ? `${publisher.firstName} ${publisher.lastName}`.trim()
      : 'UZA advisor';

    const buffer = await this.pdf.render({
      reference: file.ref,
      version,
      status: file.status,
      lenderName: file.lenderName,
      applicantName,
      applicantUzaId: file.uzaId,
      productRef: file.productRef,
      allocationRef: file.allocationRef,
      pricePaidRwf: file.pricePaidRwf,
      contributionRwf: file.contributionRwf,
      insuranceRwf: file.insuranceRwf,
      financedAmountRwf: file.financedAmountRwf,
      tenorMonths: file.tenorMonths,
      submittedAt: file.submittedAt,
      items: file.items.map((item) => ({
        code: item.code,
        label: item.label,
        source: item.source,
        present: item.present,
        documentUrl: item.documentUrl,
        generatedAt: item.generatedAt,
        uploadedAt: item.uploadedAt,
        verifiedAt: item.verifiedAt,
      })),
      audit: file.events.map((event) => ({
        at: event.at,
        actor: event.actorId,
        kind: event.kind,
        detail: event.detail,
      })),
      generatedByName,
    });

    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
    const storageUrl = await this.storage.saveBankPackage(
      file.ref,
      version,
      buffer,
    );

    const pkg = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bankPackage.create({
        data: {
          ref: `${file.ref}-v${version}`,
          bankFileId: file.id,
          version,
          storageUrl,
          checksumSha256,
          byteSize: buffer.byteLength,
          itemsSnapshot: file.items.map((item) => ({
            code: item.code,
            label: item.label,
            source: item.source,
            present: item.present,
            documentUrl: item.documentUrl,
          })) as never,
          publishedById: publishedByUserId,
        },
      });

      await tx.bankFileEvent.create({
        data: {
          bankFileId: file.id,
          actorId: publishedByUserId,
          kind: 'package_published',
          detail: `v${version} · ${checksumSha256.slice(0, 12)}…`,
        },
      });

      return created;
    });

    await this.auditService.record({
      userId: publishedByUserId,
      action: 'bank-files:package-published',
      entity: 'BankPackage',
      entityId: pkg.id,
      metadata: {
        bankFileRef: file.ref,
        version,
        checksumSha256,
        byteSize: buffer.byteLength,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return pkg;
  }

  async listVersions(bankFileRef: string) {
    const file = await this.prisma.bankFile.findUnique({
      where: { ref: bankFileRef },
      select: { id: true },
    });
    if (!file) {
      throw new NotFoundException(`bank file ${bankFileRef} not found`);
    }

    return this.prisma.bankPackage.findMany({
      where: { bankFileId: file.id },
      orderBy: { version: 'desc' },
    });
  }
}
