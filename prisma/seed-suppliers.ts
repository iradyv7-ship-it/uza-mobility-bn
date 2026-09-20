import { PrismaClient, SupplierKind, SupplierStatus } from '@prisma/client';

/**
 * The two EV-sector suppliers UZA already deals with, as reference data.
 *
 * Configuration, not business data — which supplier corresponds to which code — in the
 * same spirit as `seedLenderBanks()`. No offers and no orders are seeded: an offer that
 * was never actually made does not belong in the database even for a demo, and an offer
 * row carries a supplier's representation about a vehicle's condition, which is the last
 * thing that should ever be invented.
 *
 * Upserted by code, so re-running the seed never creates a duplicate and never overwrites
 * a status a human has since changed — only the descriptive fields are refreshed.
 */
const SUPPLIERS = [
  {
    code: 'SUP-MENTO',
    legalName: 'Mento Auto Export Ltd',
    kind: SupplierKind.EXPORTER,
    country: 'Japan',
    defaultCurrency: 'USD',
  },
  {
    code: 'SUP-MEDIATEUR',
    legalName: 'Mediateur',
    kind: SupplierKind.EXPORTER,
    country: 'Rwanda',
    defaultCurrency: 'USD',
  },
] as const;

export async function seedSuppliers(prisma: PrismaClient): Promise<void> {
  for (const supplier of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: {
        legalName: supplier.legalName,
        kind: supplier.kind,
        country: supplier.country,
        defaultCurrency: supplier.defaultCurrency,
      },
      create: {
        code: supplier.code,
        legalName: supplier.legalName,
        kind: supplier.kind,
        // Both are existing counterparties, not applicants. A supplier created through
        // the public registration route lands as PROSPECT instead.
        status: SupplierStatus.ACTIVE,
        country: supplier.country,
        defaultCurrency: supplier.defaultCurrency,
      },
    });
  }

  console.log(`✅ Seeded ${SUPPLIERS.length} suppliers`);
}
