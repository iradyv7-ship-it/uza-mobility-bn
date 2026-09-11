/**
 * Load the Unguka referral list into the Tunga Taxi programme.
 *
 *   TUNGA_CANDIDATES_JSON=/path/to/list.json npx ts-node prisma/seed-tunga-candidates.ts
 *
 * The candidate list carries real names and phone numbers, so it is NOT in this
 * repository and must never be. The path is passed in at runtime and the script refuses
 * to run without it — there is deliberately no default and no fallback fixture, because a
 * fallback is how a fixture of real people ends up committed by accident.
 *
 * Expected shape, one object per person:
 *
 *   { "candidates": [ { "row", "registeredOn", "fullName", "vehicleOfChoice",
 *                       "contributionStated", "contributionRwf", "phone" } ] }
 *
 * Idempotent on phone number, which is the only stable natural key the source has. Running
 * it twice updates rather than duplicating.
 *
 * One entry on the list is a transport company asking for several vehicles rather than an
 * individual driver. It is seeded as a single applicant regardless: a fleet agreement is a
 * different product from a driver loan, and expanding it into several driver files would
 * misstate the pipeline. Handle it separately when the fleet product exists.
 *
 * What it creates per person:
 *   · a User with an allocated UZA ID
 *   · a place in the allocation queue for the class they asked for
 *   · a bank file with all eleven items stubbed, so what is missing is a query
 */
// Only prisma.config.ts loads .env; a plain ts-node script does not, so the connection
// string would otherwise be undefined and fail with an unhelpful SASL error.
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { DEFAULT_BANK_FILE_ITEMS } from '../src/modules/bank-files/default-bank-file-items';

// Prisma 7 requires a driver adapter. Matches how src/prisma/prisma.service.ts does it,
// so the seed connects exactly the way the application does.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Candidate {
  row?: number;
  registeredOn?: string | null;
  fullName: string;
  vehicleOfChoice?: string | null;
  contributionStated?: string | null;
  contributionRwf?: number | null;
  phone?: string | null;
}

/**
 * Allocates the next UZA ID inside the caller's transaction.
 *
 * The UPDATE ... RETURNING takes a row lock, so two concurrent registrations cannot be
 * handed the same number. Never read-then-write: a gap in the sequence is harmless, a
 * reused identifier is not.
 */
async function allocateUzaId(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "id_sequences" ("id", "scope", "year", "lastValue", "updatedAt")
    VALUES (${`seq_person_${year}`}, 'person', ${year}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("scope", "year")
    DO UPDATE SET "lastValue" = "id_sequences"."lastValue" + 1,
                  "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastValue"
  `;
  return `UZA-P-${year}-${String(rows[0].lastValue).padStart(6, '0')}`;
}

/**
 * The eleven, and where each one actually comes from — the single shared definition in
 * `src/modules/bank-files/default-bank-file-items.ts`, also used at runtime as the
 * fallback for any bank with no requirements of its own configured in `LenderRequirement`.
 */
const BANK_FILE_ITEMS = DEFAULT_BANK_FILE_ITEMS;

/** Read the brand out of free text like "BYD Yuan Plus 2024 (3 Pcs)". */
const BRANDS = ['BYD', 'AION', 'Aion', 'Dongfeng', 'Geely', 'Neta', 'Skyworth', 'Venucia', 'Li Auto'];
const brandOf = (text?: string | null): string | null =>
  (text && BRANDS.find((b) => text.toUpperCase().includes(b.toUpperCase()))) || null;

async function main() {
  const path = process.env.TUNGA_CANDIDATES_JSON;
  if (!path) {
    console.error(
      'Refusing to run without TUNGA_CANDIDATES_JSON.\n' +
        'The list holds real names and phone numbers and is deliberately not in this repository.\n' +
        '  TUNGA_CANDIDATES_JSON=/path/to/list.json npx ts-node prisma/seed-tunga-candidates.ts',
    );
    process.exitCode = 1;
    return;
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { candidates: Candidate[] };
  const candidates = parsed.candidates ?? [];
  if (!candidates.length) {
    console.error('No candidates in that file.');
    process.exitCode = 1;
    return;
  }

  let created = 0;
  let updated = 0;
  let queued = 0;
  let files = 0;
  const noContribution: string[] = [];

  for (const c of candidates) {
    if (!c.phone) {
      console.warn(`skipping row ${c.row}: no phone number, and it is the only natural key here`);
      continue;
    }
    const registeredOn = c.registeredOn ? new Date(c.registeredOn) : new Date();
    const year = registeredOn.getUTCFullYear();
    // Synthetic and clearly marked. The source list has no email addresses, and inventing
    // plausible ones would eventually get something sent to them.
    const email = `driver.${c.phone}@candidates.uzamobility.local`;
    const parts = c.fullName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || parts[0];

    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { phone: c.phone! }, select: { id: true, uzaId: true } });

      let userId: string;
      let uzaId: string;

      if (existing) {
        userId = existing.id;
        uzaId = existing.uzaId ?? (await allocateUzaId(tx, year));
        await tx.user.update({
          where: { id: userId },
          data: { firstName, lastName, uzaId, isActive: true },
        });
        updated += 1;
      } else {
        uzaId = await allocateUzaId(tx, year);
        const user = await tx.user.create({
          data: {
            email,
            phone: c.phone!,
            // No password is set for a referral candidate: they have not signed up, the
            // bank sent their details. An unusable hash is honest; a known one is a
            // back door into forty-two accounts.
            passwordHash: 'REFERRAL_NO_LOGIN',
            firstName,
            lastName,
            uzaId,
            preferredLanguage: 'rw',
            isActive: true,
            createdAt: registeredOn,
          },
        });
        userId = user.id;
        created += 1;
      }

      // Their place in the line. `readyAt` is the referral date for now — it becomes the
      // date they are genuinely ready (contribution paid, training done, file approved)
      // as those land, which is the whole point of the field.
      const queueRef = `UZM-AQ-${year}-${String(c.row ?? 0).padStart(6, '0')}`;
      await tx.allocationQueue.upsert({
        where: { uzaId_classCode: { uzaId, classCode: 'CAR' } },
        create: {
          ref: queueRef,
          uzaId,
          classCode: 'CAR',
          readyAt: registeredOn,
          preferredMake: brandOf(c.vehicleOfChoice),
          preferredModel: c.vehicleOfChoice ?? null,
        },
        update: {
          preferredMake: brandOf(c.vehicleOfChoice),
          preferredModel: c.vehicleOfChoice ?? null,
        },
      });
      queued += 1;

      // The bank file, opened with all eleven items stubbed. "What is missing" becomes a
      // query rather than someone's memory, and the weekly bottleneck becomes visible by
      // item type rather than as a general feeling that paperwork is slow.
      const fileRef = `UZM-BF-${year}-${String(c.row ?? 0).padStart(6, '0')}`;
      const file = await tx.bankFile.upsert({
        where: { ref: fileRef },
        create: {
          ref: fileRef,
          uzaId,
          lenderName: 'LOLC Unguka',
          productRef: 'UZM-FP-CAR-UNGUKA-V1',
          contributionRwf: c.contributionRwf ? BigInt(c.contributionRwf) : null,
          status: 'building',
        },
        update: { contributionRwf: c.contributionRwf ? BigInt(c.contributionRwf) : null },
      });

      for (const item of BANK_FILE_ITEMS) {
        await tx.bankFileItem.upsert({
          where: { bankFileId_code: { bankFileId: file.id, code: item.code } },
          create: { bankFileId: file.id, code: item.code, label: item.label, source: item.source },
          update: { label: item.label, source: item.source },
        });
      }
      // Proof of contribution is the one item some of them have already satisfied.
      if (c.contributionRwf) {
        await tx.bankFileItem.updateMany({
          where: { bankFileId: file.id, code: 'CONTRIBUTION_PROOF' },
          data: { present: true, generatedAt: registeredOn },
        });
      }
      files += 1;
    });

    if (!c.contributionRwf) noContribution.push(`row ${c.row}`);
  }

  console.log(`${created} created, ${updated} updated`);
  console.log(`${queued} in the allocation queue for CAR`);
  console.log(`${files} bank files opened, ${files * BANK_FILE_ITEMS.length} items stubbed`);
  if (noContribution.length) {
    console.log(`${noContribution.length} with no stated contribution: ${noContribution.join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
