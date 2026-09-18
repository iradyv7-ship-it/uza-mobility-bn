import { z } from 'zod';

/**
 * Ported from `src/modules/platform-settings/dto/update-platform-settings.dto.ts` —
 * same fields, same bounds. zod in place of class-validator/class-transformer (the
 * master spec's own "or an appropriate alternative"), but every `@Min`/`@Max`/
 * `@MinLength` below is the identical number, not a re-guess.
 */
export const updatePlatformSettingsSchema = z
  .object({
    bookingFeeUsd: z.coerce.number().min(0.01).optional(),
    // Whole RWF, never a float — see inspection-economics.ts's own convention.
    inspectionRateRwf: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(500_000)
      .optional(),
    companyLegalName: z.string().trim().min(1).optional(),
    companyBankName: z.string().trim().min(1).optional(),
    companyAccountNumber: z.string().trim().min(1).optional(),
    companyBankNameRwf: z.string().trim().min(1).optional(),
    companyAccountNumberRwf: z.string().trim().min(1).optional(),
    companyWhatsappNumber: z.string().trim().min(8).optional(),
    rwfMarkupPercent: z.coerce.number().min(0).max(100).optional(),
  })
  .strict();

export type UpdatePlatformSettingsInput = z.infer<
  typeof updatePlatformSettingsSchema
>;
