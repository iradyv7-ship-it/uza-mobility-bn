import { Injectable } from '@nestjs/common';
import { StorageService } from '../../common/uploads/storage.service';
import { UploadFolder } from '../../common/uploads/upload.constants';

/**
 * Archives one published bank-package PDF. Mirrors `FleetPdfStorageService` exactly —
 * same storage backend, same "one generated document, one small wrapper" shape — so a
 * reader who already knows that file knows this one.
 */
@Injectable()
export class BankPackageStorageService {
  constructor(private readonly storage: StorageService) {}

  async saveBankPackage(
    bankFileRef: string,
    version: number,
    buffer: Buffer,
  ): Promise<string> {
    const filename = `${bankFileRef.replace(/\//g, '-')}-v${version}.pdf`;

    const asset = await this.storage.uploadBuffer(
      buffer,
      UploadFolder.BANK_PACKAGES,
      filename,
      'application/pdf',
    );

    return asset.url;
  }
}
