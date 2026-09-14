import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { ExchangeRateService } from './exchange-rate.service';
import {
  DEFAULT_BOOKING_FEE_USD,
  DEFAULT_INSPECTION_RATE_RWF,
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTING_KEYS,
  type CompanyPaymentDetails,
  type PlatformSettingKey,
  type PlatformSettingsSnapshot,
} from './platform-settings.constants';

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  getDefault(key: PlatformSettingKey): string {
    return DEFAULT_PLATFORM_SETTINGS[key];
  }

  async getString(key: PlatformSettingKey): Promise<string> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key },
    });
    const value = row?.value?.trim();
    return value || this.getDefault(key);
  }

  async getBookingFeeUsd(): Promise<number> {
    const raw = await this.getString(PLATFORM_SETTING_KEYS.bookingFeeUsd);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_BOOKING_FEE_USD;
  }

  /** The contracted inspection fee — see inspection-economics.ts's header comment. Was a
   * hardcoded constant; a SUPER_ADMIN can now change it once a real garage rate is agreed,
   * without a deploy. Every caller that priced an inspection off the old constant reads
   * this instead. */
  async getInspectionRateRwf(): Promise<number> {
    const raw = await this.getString(PLATFORM_SETTING_KEYS.inspectionRateRwf);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_INSPECTION_RATE_RWF;
  }

  async getCompanyPaymentDetails(): Promise<CompanyPaymentDetails> {
    const [
      legalName,
      usdBankName,
      usdAccountNumber,
      rwfBankName,
      rwfAccountNumber,
      whatsappNumber,
    ] = await Promise.all([
      this.getString(PLATFORM_SETTING_KEYS.companyLegalName),
      this.getString(PLATFORM_SETTING_KEYS.companyBankName),
      this.getString(PLATFORM_SETTING_KEYS.companyAccountNumber),
      this.getString(PLATFORM_SETTING_KEYS.companyBankNameRwf),
      this.getString(PLATFORM_SETTING_KEYS.companyAccountNumberRwf),
      this.getString(PLATFORM_SETTING_KEYS.companyWhatsappNumber),
    ]);

    return {
      legalName,
      whatsappNumber,
      usd: { bankName: usdBankName, accountNumber: usdAccountNumber },
      rwf: { bankName: rwfBankName, accountNumber: rwfAccountNumber },
    };
  }

  buildWhatsAppUrl(whatsappNumber: string, message: string): string {
    const digits = whatsappNumber.replace(/\D/g, '');
    if (!digits) {
      return 'https://wa.me/';
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }

  async getSettings(): Promise<PlatformSettingsSnapshot> {
    const bookingFeeUsd = await this.getBookingFeeUsd();
    const inspectionRateRwf = await this.getInspectionRateRwf();
    const company = await this.getCompanyPaymentDetails();
    const exchangeRate = await this.exchangeRateService.getSnapshot({
      refreshIfStale: false,
    });

    return {
      bookingFeeUsd,
      inspectionRateRwf,
      companyLegalName: company.legalName,
      companyBankName: company.usd.bankName,
      companyAccountNumber: company.usd.accountNumber,
      companyBankNameRwf: company.rwf.bankName,
      companyAccountNumberRwf: company.rwf.accountNumber,
      companyWhatsappNumber: company.whatsappNumber,
      currency: 'USDT',
      rwfMarkupPercent: exchangeRate.markupPercent,
      exchangeRate,
    };
  }

  async updateSettings(
    adminId: string,
    dto: UpdatePlatformSettingsDto,
    auditContext: RequestAuditContext = {},
  ): Promise<PlatformSettingsSnapshot> {
    const updates: Array<{ key: PlatformSettingKey; value: string }> = [];

    if (dto.bookingFeeUsd != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.bookingFeeUsd,
        value: String(dto.bookingFeeUsd),
      });
    }
    if (dto.inspectionRateRwf != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.inspectionRateRwf,
        value: String(dto.inspectionRateRwf),
      });
    }
    if (dto.companyLegalName != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyLegalName,
        value: dto.companyLegalName.trim(),
      });
    }
    if (dto.companyBankName != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyBankName,
        value: dto.companyBankName.trim(),
      });
    }
    if (dto.companyAccountNumber != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyAccountNumber,
        value: dto.companyAccountNumber.trim(),
      });
    }
    if (dto.companyBankNameRwf != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyBankNameRwf,
        value: dto.companyBankNameRwf.trim(),
      });
    }
    if (dto.companyAccountNumberRwf != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyAccountNumberRwf,
        value: dto.companyAccountNumberRwf.trim(),
      });
    }
    if (dto.companyWhatsappNumber != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.companyWhatsappNumber,
        value: dto.companyWhatsappNumber.replace(/\D/g, ''),
      });
    }
    if (dto.rwfMarkupPercent != null) {
      updates.push({
        key: PLATFORM_SETTING_KEYS.rwfMarkupPercent,
        value: String(dto.rwfMarkupPercent),
      });
    }

    if (updates.length === 0) {
      return this.getSettings();
    }

    await this.prisma.$transaction(
      updates.map(({ key, value }) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: adminId },
          update: { value, updatedBy: adminId },
        }),
      ),
    );

    if (dto.rwfMarkupPercent != null) {
      await this.exchangeRateService.recomputeEffective(adminId);
    }

    await this.auditService.record({
      userId: adminId,
      action: 'platform-settings:updated',
      entity: 'PlatformSetting',
      entityId: 'platform-settings',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: Object.fromEntries(
        updates.map(({ key, value }) => [key, value]),
      ),
    });

    return this.getSettings();
  }
}
