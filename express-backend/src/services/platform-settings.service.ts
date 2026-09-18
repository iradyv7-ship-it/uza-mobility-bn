import { prisma } from '../config/prisma';
import * as exchangeRate from './exchange-rate.service';
import { recordActivity } from './audit.service';
import {
  DEFAULT_BOOKING_FEE_USD,
  DEFAULT_INSPECTION_RATE_RWF,
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTING_KEYS,
  type CompanyPaymentDetails,
  type PlatformSettingKey,
  type PlatformSettingsSnapshot,
} from '../config/platform-settings.constants';
import type { UpdatePlatformSettingsInput } from '../validators/platform-settings.validator';

/** Ported from `src/modules/platform-settings/platform-settings.service.ts` — same
 * getters, same update semantics (only the keys present in the input are touched, an
 * audit row records the change, a markup-percent change triggers a rate recompute). */

function getDefault(key: PlatformSettingKey): string {
  return DEFAULT_PLATFORM_SETTINGS[key];
}

async function getString(key: PlatformSettingKey): Promise<string> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const value = row?.value?.trim();
  return value || getDefault(key);
}

export async function getBookingFeeUsd(): Promise<number> {
  const raw = await getString(PLATFORM_SETTING_KEYS.bookingFeeUsd);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BOOKING_FEE_USD;
}

export async function getInspectionRateRwf(): Promise<number> {
  const raw = await getString(PLATFORM_SETTING_KEYS.inspectionRateRwf);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_INSPECTION_RATE_RWF;
}

export async function getCompanyPaymentDetails(): Promise<CompanyPaymentDetails> {
  const [
    legalName,
    usdBankName,
    usdAccountNumber,
    rwfBankName,
    rwfAccountNumber,
    whatsappNumber,
  ] = await Promise.all([
    getString(PLATFORM_SETTING_KEYS.companyLegalName),
    getString(PLATFORM_SETTING_KEYS.companyBankName),
    getString(PLATFORM_SETTING_KEYS.companyAccountNumber),
    getString(PLATFORM_SETTING_KEYS.companyBankNameRwf),
    getString(PLATFORM_SETTING_KEYS.companyAccountNumberRwf),
    getString(PLATFORM_SETTING_KEYS.companyWhatsappNumber),
  ]);

  return {
    legalName,
    whatsappNumber,
    usd: { bankName: usdBankName, accountNumber: usdAccountNumber },
    rwf: { bankName: rwfBankName, accountNumber: rwfAccountNumber },
  };
}

export async function getSettings(): Promise<PlatformSettingsSnapshot> {
  const bookingFeeUsd = await getBookingFeeUsd();
  const inspectionRateRwf = await getInspectionRateRwf();
  const company = await getCompanyPaymentDetails();
  const exchangeRateSnapshot = await exchangeRate.getSnapshot({
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
    rwfMarkupPercent: exchangeRateSnapshot.markupPercent,
    exchangeRate: exchangeRateSnapshot,
  };
}

export async function updateSettings(
  adminId: string,
  dto: UpdatePlatformSettingsInput,
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
    return getSettings();
  }

  await prisma.$transaction(
    updates.map(({ key, value }) =>
      prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: adminId },
        update: { value, updatedBy: adminId },
      }),
    ),
  );

  if (dto.rwfMarkupPercent != null) {
    await exchangeRate.recomputeEffective(adminId);
  }

  await recordActivity({
    userId: adminId,
    action: 'platform-settings:updated',
    entity: 'PlatformSetting',
    entityId: 'platform-settings',
    metadata: Object.fromEntries(updates.map(({ key, value }) => [key, value])),
  });

  return getSettings();
}
