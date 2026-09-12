import 'dotenv/config';
import { PrismaClient, SellerType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { genSaltSync, hashSync } from 'bcryptjs';
import { seedCategories } from './seed-categories';
import { seedListings } from './seed-listings';
import { seedPlatformSettings } from './seed-platform-settings';
import { seedPricingRules } from './seed-pricing-rules';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
  }),
  errorFormat: 'pretty',
});

async function ensureRole(name: string, description?: string) {
  return prisma.role.upsert({
    where: { name },
    update: { description: description ?? undefined },
    create: { name, description: description ?? null },
  });
}

async function ensurePermission(action: string, description?: string) {
  return prisma.permission.upsert({
    where: { action },
    update: { description: description ?? undefined },
    create: { action, description: description ?? null },
  });
}

async function ensureUserWithRoles(params: {
  email: string;
  plainPassword: string;
  firstName: string;
  lastName: string;
  roleNames: string[];
  phone?: string;
  preferredLanguage?: string;
}) {
  const passwordHash = hashSync(params.plainPassword, genSaltSync(10));

  const user = await prisma.user.upsert({
    where: { email: params.email },
    update: {
      passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone ?? undefined,
      preferredLanguage: params.preferredLanguage ?? 'en',
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
    create: {
      email: params.email,
      phone: params.phone ?? null,
      passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      preferredLanguage: params.preferredLanguage ?? 'en',
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });

  // Ensure the user-role links exist (many roles per user supported)
  const roleRecords = await Promise.all(
    params.roleNames.map((r) => ensureRole(r, `Seed role: ${r}`)),
  );

  await Promise.all(
    roleRecords.map((role) =>
      prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: role.id,
        },
      }),
    ),
  );
}

async function seedPermissionsAndRoleMappings() {
  const permissions = [
    'listings:create',
    'listings:read',
    'listings:approve',
    'listings:reject',
    'listings:feature',
    'listings:delete',
    'invoices:create',
    'invoices:read',
    'invoices:send',
    'invoices:cancel',
    'payments:submit',
    'payments:verify',
    'payments:reject',
    'payments:refund',
    'bookings:create',
    'bookings:read',
    'bookings:manage',
    'bookings:verify',
    'bookings:reject',
    'platform-settings:manage',
    'orders:read',
    'orders:update-status',
    'sellers:verify',
    'sellers:suspend',
    'fleet:read',
    'fleet:update-status',
    'financing:read',
    'financing:send-to-bank',
    'promotions:create',
    'promotions:manage',
    'sustainability:read',
    'sustainability:manage',
    'users:read',
    'users:manage-roles',
    'parts:create',
    'parts:manage',
    'financing:submit',
    'stations:create',
    'stations:update',
    'stations:submit',
    'stations:read-own',
    'stations:approve',
    'stations:reject',
    'stations:suspend',
    'stations:read-all',
    'inquiries:read-own',
    'inquiries:read-all',
    'inquiries:update-status',
    'fund-applications:manage',
  ];

  const permissionRecords = await Promise.all(
    permissions.map((action) => ensurePermission(action)),
  );

  const roleMappings: Record<string, string[]> = {
    SUPER_ADMIN: ['*'],
    MARKETPLACE_ADMIN: [
      'listings:create',
      'listings:read',
      'listings:feature',
      'listings:delete',
      'sellers:verify',
      'sellers:suspend',
      'parts:manage',
      'stations:approve',
      'stations:reject',
      'stations:suspend',
      'stations:read-all',
      'fund-applications:manage',
    ],
    FINANCE_ADMIN: [
      'invoices:read',
      'invoices:send',
      'invoices:cancel',
      'payments:verify',
      'payments:reject',
      'payments:refund',
      'bookings:manage',
      'bookings:verify',
      'bookings:reject',
      'platform-settings:manage',
      'financing:read',
      'financing:send-to-bank',
      'fund-applications:manage',
    ],
    // The person at the intake table, reading the form aloud and keying it in. Exactly one
    // permission. Until 12 September 2026 this job was done with FINANCE_ADMIN, which also
    // carries payments:refund and platform-settings:manage — far more than a field officer
    // should hold, and far more than a field officer wants to be responsible for.
    INTAKE_OFFICER: ['fund-applications:manage'],
    LOGISTICS_ADMIN: ['orders:read', 'orders:update-status'],
    FLEET_ADMIN: ['fleet:read', 'fleet:update-status', 'listings:read'],
    SUSTAINABILITY_ADMIN: ['sustainability:read', 'sustainability:manage', 'orders:read'],
    ADVERTISING_ADMIN: ['promotions:create', 'promotions:manage', 'listings:feature'],
    SALES_AGENT: [
      'listings:read',
      'orders:read',
      'inquiries:read-all',
      'inquiries:update-status',
    ],
    SELLER: ['listings:create', 'listings:read', 'parts:create'],
    CHARGING_OPERATOR: [
      'stations:create',
      'stations:update',
      'stations:submit',
      'stations:read-own',
    ],
    BUYER: [
      'listings:read',
      'invoices:create',
      'payments:submit',
      'bookings:create',
      'bookings:read',
      'orders:read',
      'financing:submit',
    ],
  };

  const allActionToRecord = new Map(
    permissionRecords.map((record) => [record.action, record]),
  );

  for (const [roleName, allowedActions] of Object.entries(roleMappings)) {
    const role = await ensureRole(roleName);

    const actionsToAttach =
      allowedActions.includes('*') ? permissions : allowedActions;

    await Promise.all(
      actionsToAttach.map((action) => {
        const permission = allActionToRecord.get(action);
        if (!permission) {
          throw new Error(`Permission not seeded: ${action}`);
        }

        return prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }),
    );
  }

  // Workshop and lender-portal roles. Checked by name via RolesGuard, not by the
  // permission-string model above — see src/modules/workshop/*.controller.ts and
  // src/modules/financing/guards/lender-access.guard.ts. They still need a Role row to
  // exist before an admin can assign one to a user.
  await Promise.all(
    [
      'MECHANIC',
      'WORKSHOP_ADMIN',
      'LENDER_UNGUKA',
      'LENDER_EQUITY',
      'LENDER_NCBA',
    ].map((name) => ensureRole(name, `Seed role: ${name}`)),
  );
}

/**
 * Links each configured lender (src/modules/financing/lenders.registry.ts) to a Bank
 * row, upserting by name so re-running the seed never creates a duplicate. This is
 * configuration — which bank corresponds to which lender-portal key — not business data;
 * no Loan rows are seeded here, because a loan that was never actually disbursed does not
 * belong in the database even for a demo.
 */
async function seedLenderBanks() {
  const lenders: Array<{ key: string; name: string }> = [
    { key: 'unguka', name: 'Unguka Bank (LOLC)' },
    { key: 'equity', name: 'Equity Bank Rwanda' },
    { key: 'ncba', name: 'NCBA Rwanda' },
  ];

  for (const lender of lenders) {
    const existing = await prisma.bank.findFirst({ where: { name: lender.name } });
    if (existing) {
      await prisma.bank.update({
        where: { id: existing.id },
        data: { lenderKey: lender.key },
      });
    } else {
      await prisma.bank.create({
        data: { name: lender.name, country: 'Rwanda', lenderKey: lender.key },
      });
    }
  }
}

function resolveSeedAccount(config: {
  label: string;
  emailKey: string;
  passwordKey: string;
  firstNameKey: string;
  lastNameKey: string;
  rolesKey: string;
  defaultFirstName: string;
  defaultLastName: string;
  defaultRoles: string[];
}) {
  const email = process.env[config.emailKey]?.trim();
  const plainPassword = process.env[config.passwordKey];
  if (!email || !plainPassword) {
    return null;
  }

  const rolesRaw =
    process.env[config.rolesKey]?.trim() || config.defaultRoles.join(',');

  return {
    email,
    plainPassword,
    firstName:
      process.env[config.firstNameKey]?.trim() || config.defaultFirstName,
    lastName: process.env[config.lastNameKey]?.trim() || config.defaultLastName,
    roleNames: rolesRaw
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    preferredLanguage: 'en' as const,
  };
}

async function seedAccountIfConfigured(config: Parameters<typeof resolveSeedAccount>[0]) {
  const account = resolveSeedAccount(config);
  if (!account) {
    console.log(
      `⏭️  Skipping ${config.label} (set ${config.emailKey} and ${config.passwordKey} to seed)`,
    );
    return null;
  }

  await ensureUserWithRoles(account);
  return account;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL. Add it to your .env before running prisma:seed.');
  }

  // Roles for login testing
  await seedPermissionsAndRoleMappings();

  const adminAccount = await seedAccountIfConfigured({
    label: 'admin account',
    emailKey: 'SEED_ADMIN_EMAIL',
    passwordKey: 'SEED_ADMIN_PASSWORD',
    firstNameKey: 'SEED_ADMIN_FIRST_NAME',
    lastNameKey: 'SEED_ADMIN_LAST_NAME',
    rolesKey: 'SEED_ADMIN_ROLES',
    defaultFirstName: 'UZA',
    defaultLastName: 'Admin',
    defaultRoles: ['SUPER_ADMIN', 'SELLER'],
  });

  if (adminAccount) {
    const adminUser = await prisma.user.findUnique({
      where: { email: adminAccount.email },
    });

    if (adminUser) {
      for (const sellerType of [
        SellerType.UZA_RWANDA_STOCK,
        SellerType.UZA_CHINA_SOURCING,
      ] as const) {
        const label =
          sellerType === SellerType.UZA_RWANDA_STOCK
            ? 'UZA Rwanda Stock'
            : 'UZA China Sourcing';

        await prisma.seller.upsert({
          where: {
            userId_sellerType: {
              userId: adminUser.id,
              sellerType,
            },
          },
          update: {
            businessName: label,
            status: 'ACTIVE',
            country: 'RW',
            city: 'Kigali',
            isVerified: true,
          },
          create: {
            userId: adminUser.id,
            businessName: label,
            sellerType,
            status: 'ACTIVE',
            country: 'RW',
            city: 'Kigali',
            isVerified: true,
          },
        });
      }
    }
  }

  await seedAccountIfConfigured({
    label: 'buyer account',
    emailKey: 'SEED_BUYER_EMAIL',
    passwordKey: 'SEED_BUYER_PASSWORD',
    firstNameKey: 'SEED_BUYER_FIRST_NAME',
    lastNameKey: 'SEED_BUYER_LAST_NAME',
    rolesKey: 'SEED_BUYER_ROLES',
    defaultFirstName: 'Rwanda',
    defaultLastName: 'Buyer',
    defaultRoles: ['BUYER'],
  });

  await seedAccountIfConfigured({
    label: 'logistics account',
    emailKey: 'SEED_LOGISTICS_EMAIL',
    passwordKey: 'SEED_LOGISTICS_PASSWORD',
    firstNameKey: 'SEED_LOGISTICS_FIRST_NAME',
    lastNameKey: 'SEED_LOGISTICS_LAST_NAME',
    rolesKey: 'SEED_LOGISTICS_ROLES',
    defaultFirstName: 'UZA',
    defaultLastName: 'Logistics',
    defaultRoles: ['LOGISTICS_ADMIN'],
  });

  await seedAccountIfConfigured({
    label: 'fleet account',
    emailKey: 'SEED_FLEET_EMAIL',
    passwordKey: 'SEED_FLEET_PASSWORD',
    firstNameKey: 'SEED_FLEET_FIRST_NAME',
    lastNameKey: 'SEED_FLEET_LAST_NAME',
    rolesKey: 'SEED_FLEET_ROLES',
    defaultFirstName: 'UZA',
    defaultLastName: 'Fleet',
    defaultRoles: ['FLEET_ADMIN'],
  });

  await seedAccountIfConfigured({
    label: 'finance account',
    emailKey: 'SEED_FINANCE_EMAIL',
    passwordKey: 'SEED_FINANCE_PASSWORD',
    firstNameKey: 'SEED_FINANCE_FIRST_NAME',
    lastNameKey: 'SEED_FINANCE_LAST_NAME',
    rolesKey: 'SEED_FINANCE_ROLES',
    defaultFirstName: 'UZA',
    defaultLastName: 'Finance',
    defaultRoles: ['FINANCE_ADMIN'],
  });

  const sellerAccount = await seedAccountIfConfigured({
    label: 'seller account',
    emailKey: 'SEED_SELLER_EMAIL',
    passwordKey: 'SEED_SELLER_PASSWORD',
    firstNameKey: 'SEED_SELLER_FIRST_NAME',
    lastNameKey: 'SEED_SELLER_LAST_NAME',
    rolesKey: 'SEED_SELLER_ROLES',
    defaultFirstName: 'Kigali',
    defaultLastName: 'Seller',
    defaultRoles: ['BUYER', 'SELLER'],
  });

  if (sellerAccount) {
    const sellerUser = await prisma.user.findUnique({
      where: { email: sellerAccount.email },
    });

    if (sellerUser) {
      await prisma.seller.upsert({
        where: {
          userId_sellerType: {
            userId: sellerUser.id,
            sellerType: SellerType.LOCAL_SELLER,
          },
        },
        update: {
          businessName: 'Kigali EV Motors',
          status: 'ACTIVE',
          country: 'RW',
          city: 'Kigali',
          isVerified: true,
        },
        create: {
          userId: sellerUser.id,
          businessName: 'Kigali EV Motors',
          sellerType: SellerType.LOCAL_SELLER,
          status: 'ACTIVE',
          country: 'RW',
          city: 'Kigali',
          isVerified: true,
        },
      });
    }
  }

  await seedCategories(prisma);
  await seedPricingRules(prisma);
  await seedPlatformSettings(prisma);
  await seedListings(prisma);
  await seedLenderBanks();

  console.log('✅ Prisma seed completed');
}

main()
  .catch((e) => {
    console.error('❌ Prisma seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

