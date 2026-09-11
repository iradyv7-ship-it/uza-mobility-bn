import { Module } from '@nestjs/common';
import { PdfModule } from '../../common/pdf/pdf.module';
import { UploadsModule } from '../../common/uploads/uploads.module';
import { AuthModule } from '../auth/auth.module';
import { BankFileGeneratorService } from './bank-file-generator.service';
import { BankFilesController } from './bank-files.controller';
import { BankPackagePdfService } from './bank-package-pdf.service';
import { BankPackageService } from './bank-package.service';
import { BankPackageStorageService } from './bank-package-storage.service';

/**
 * Bank file assembly for the Tunga Taxi programme.
 *
 * Seven of the eleven items a lender asks for are facts the platform already holds. This
 * module produces those and refuses to touch the other four, which is what makes the
 * "what is still missing" number trustworthy enough to act on.
 *
 * `BankPackageService` is the other half: once a file is actually complete, it renders,
 * checksums and archives the PDF a bank is handed — see its own doc comment.
 */
@Module({
  imports: [AuthModule, PdfModule, UploadsModule],
  controllers: [BankFilesController],
  providers: [
    BankFileGeneratorService,
    BankPackagePdfService,
    BankPackageStorageService,
    BankPackageService,
  ],
  exports: [BankFileGeneratorService, BankPackageService],
})
export class BankFilesModule {}
