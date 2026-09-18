import { prisma } from '../config/prisma';
import { loadEnv } from '../config/env';
import { ServiceUnavailableError } from '../middleware/error.middleware';
import {
  DEFAULT_RWF_MARKUP_PERCENT,
  PLATFORM_SETTING_KEYS,
  type ExchangeRateSnapshot,
} from '../config/platform-settings.constants';

/** Ported from `src/modules/platform-settings/exchange-rate.service.ts` — same caching,
 * same staleness window, same fallback defaults, same upsert-three-keys-in-one-transaction
 * shape on refresh. */

type ExchangeRateApiResponse = {
  result?: string;
  conversion_rates?: Record<string, number>;
};

const STALE_MS = 24 * 60 * 60 * 1000;

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const value = row?.value?.trim();
  return value || fallback;
}

async function getCachedNumber(key: string): Promise<number | null> {
  const raw = await getSetting(key, '');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getCachedDate(key: string): Promise<Date | null> {
  const raw = await getSetting(key, '');
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function upsertSetting(key: string, value: string, adminId?: string) {
  return prisma.platformSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: adminId },
    update: { value, updatedBy: adminId },
  });
}

export async function getMarkupPercent(): Promise<number> {
  const raw = await getSetting(
    PLATFORM_SETTING_KEYS.rwfMarkupPercent,
    String(DEFAULT_RWF_MARKUP_PERCENT),
  );
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_RWF_MARKUP_PERCENT;
}

export async function refreshFromApi(
  adminId?: string,
): Promise<ExchangeRateSnapshot> {
  const env = loadEnv();
  const apiKey = env.exchangeRateApiKey;
  if (!apiKey) {
    throw new ServiceUnavailableError(
      'EXCHANGE_RATE_API_KEY is not configured',
    );
  }

  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new ServiceUnavailableError(
      `Exchange rate API returned ${response.status}`,
    );
  }

  const body = (await response.json()) as ExchangeRateApiResponse;
  if (body.result !== 'success' || body.conversion_rates?.RWF == null) {
    throw new ServiceUnavailableError(
      'Exchange rate API response missing RWF rate',
    );
  }

  const apiRate = Number(body.conversion_rates.RWF);
  if (!Number.isFinite(apiRate) || apiRate <= 0) {
    throw new ServiceUnavailableError('Invalid RWF rate from API');
  }

  const markupPercent = await getMarkupPercent();
  const effective = apiRate * (1 + markupPercent / 100);
  const fetchedAt = new Date().toISOString();

  await prisma.$transaction([
    upsertSetting(PLATFORM_SETTING_KEYS.usdToRwfApi, String(apiRate), adminId),
    upsertSetting(
      PLATFORM_SETTING_KEYS.usdToRwfEffective,
      String(effective),
      adminId,
    ),
    upsertSetting(PLATFORM_SETTING_KEYS.rateFetchedAt, fetchedAt, adminId),
  ]);

  return {
    usdToRwfApi: apiRate,
    usdToRwfEffective: effective,
    markupPercent,
    rateFetchedAt: fetchedAt,
    baseCurrency: 'USDT',
    quoteCurrency: 'RWF',
  };
}

export async function recomputeEffective(
  adminId?: string,
): Promise<ExchangeRateSnapshot> {
  const markupPercent = await getMarkupPercent();
  const apiRate =
    (await getCachedNumber(PLATFORM_SETTING_KEYS.usdToRwfApi)) ?? 1472.8279;
  const effective = apiRate * (1 + markupPercent / 100);
  const fetchedAt =
    (await getSetting(PLATFORM_SETTING_KEYS.rateFetchedAt, '')) ||
    new Date().toISOString();

  await upsertSetting(
    PLATFORM_SETTING_KEYS.usdToRwfEffective,
    String(effective),
    adminId,
  );

  return {
    usdToRwfApi: apiRate,
    usdToRwfEffective: effective,
    markupPercent,
    rateFetchedAt: fetchedAt,
    baseCurrency: 'USDT',
    quoteCurrency: 'RWF',
  };
}

export async function getSnapshot(options?: {
  refreshIfStale?: boolean;
}): Promise<ExchangeRateSnapshot> {
  const refreshIfStale = options?.refreshIfStale !== false;
  let apiRate = await getCachedNumber(PLATFORM_SETTING_KEYS.usdToRwfApi);
  let effective = await getCachedNumber(
    PLATFORM_SETTING_KEYS.usdToRwfEffective,
  );
  const fetchedAt = await getCachedDate(PLATFORM_SETTING_KEYS.rateFetchedAt);
  const markupPercent = await getMarkupPercent();

  const isStale =
    !apiRate ||
    !effective ||
    !fetchedAt ||
    Date.now() - fetchedAt.getTime() > STALE_MS;

  if (refreshIfStale && isStale) {
    try {
      return await refreshFromApi();
    } catch (error) {
      console.warn(
        `Exchange rate refresh failed, using cache if available: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!apiRate || !effective) throw error;
    }
  }

  if (!apiRate || !effective) {
    apiRate = apiRate ?? 1472.8279;
    effective = effective ?? apiRate * (1 + markupPercent / 100);
  }

  return {
    usdToRwfApi: apiRate,
    usdToRwfEffective: effective,
    markupPercent,
    rateFetchedAt: fetchedAt?.toISOString() ?? null,
    baseCurrency: 'USDT',
    quoteCurrency: 'RWF',
  };
}
