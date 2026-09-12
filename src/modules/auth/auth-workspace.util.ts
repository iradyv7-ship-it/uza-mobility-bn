import { SellerType } from '@prisma/client';
import { isMarketplaceSellerType } from '../sellers/seller-profile.util';

/** Roles that use uza-mobility-admin (aligned with frontend PLATFORM_STAFF_ROLES). */
export const PLATFORM_STAFF_ROLES = [
  'SUPER_ADMIN',
  'MARKETPLACE_ADMIN',
  'FINANCE_ADMIN',
  'LOGISTICS_ADMIN',
  'FLEET_ADMIN',
  'SUSTAINABILITY_ADMIN',
  'ADVERTISING_ADMIN',
  'SALES_AGENT',
  'INTAKE_OFFICER',
  'TRAINER',
] as const;

const ADMIN_PERMISSION_MARKERS = [
  'listings:approve',
  'listings:reject',
  'listings:feature',
  'listings:delete',
  'payments:verify',
  'payments:reject',
  'payments:refund',
  'invoices:send',
  'invoices:cancel',
  'financing:read',
  'financing:send-to-bank',
  'fleet:read',
  'fleet:update-status',
  'promotions:create',
  'promotions:manage',
  'sustainability:read',
  'sustainability:manage',
  'sellers:verify',
  'sellers:suspend',
  'users:manage-roles',
  'users:read',
  'orders:update-status',
  'invoices:read',
  'parts:manage',
  'stations:read-all',
  'stations:approve',
  'stations:reject',
  'stations:suspend',
] as const;

const BUYER_WORKSPACE_PERMISSIONS = [
  'orders:read',
  'invoices:create',
  'payments:submit',
  'financing:submit',
] as const;

const OPERATOR_WORKSPACE_PERMISSIONS = [
  'stations:create',
  'stations:update',
  'stations:submit',
  'stations:read-own',
] as const;

const SELLER_WORKSPACE_PERMISSIONS = [
  'listings:create',
  'parts:create',
] as const;

export type AuthWorkspaceContext = {
  roleNames: string[];
  permissions: string[];
  sellers: { sellerType: SellerType }[];
  hasOperatorProfile: boolean;
};

function canAny(permissions: string[], actions: readonly string[]): boolean {
  if (permissions.includes('*')) return true;
  return actions.some((action) => permissions.includes(action));
}

export function hasAdminAccess(
  roleNames: string[],
  permissions: string[],
): boolean {
  if (permissions.includes('*')) {
    return true;
  }

  if (
    roleNames.some((role) =>
      (PLATFORM_STAFF_ROLES as readonly string[]).includes(role),
    )
  ) {
    return true;
  }

  return permissions.some((permission) =>
    (ADMIN_PERMISSION_MARKERS as readonly string[]).includes(permission),
  );
}

function hasBuyerWorkspace(
  roleNames: string[],
  permissions: string[],
): boolean {
  if (hasAdminAccess(roleNames, permissions)) {
    return false;
  }
  if (roleNames.includes('BUYER')) {
    return true;
  }
  return canAny(permissions, BUYER_WORKSPACE_PERMISSIONS);
}

function hasSellerWorkspace(
  permissions: string[],
  sellers: { sellerType: SellerType }[],
): boolean {
  const marketplaceSeller = sellers.find((seller) =>
    isMarketplaceSellerType(seller.sellerType),
  );
  if (!marketplaceSeller) {
    return false;
  }
  return canAny(permissions, SELLER_WORKSPACE_PERMISSIONS);
}

function hasOperatorWorkspace(
  roleNames: string[],
  permissions: string[],
): boolean {
  if (hasAdminAccess(roleNames, permissions)) {
    return false;
  }
  if (roleNames.includes('CHARGING_OPERATOR')) {
    return true;
  }
  return canAny(permissions, OPERATOR_WORKSPACE_PERMISSIONS);
}

export function hasMarketplaceWorkspace(ctx: AuthWorkspaceContext): boolean {
  return (
    hasBuyerWorkspace(ctx.roleNames, ctx.permissions) ||
    hasSellerWorkspace(ctx.permissions, ctx.sellers) ||
    hasOperatorWorkspace(ctx.roleNames, ctx.permissions) ||
    ctx.hasOperatorProfile
  );
}

/** Staff without buyer/seller/operator access on the marketplace app. */
export function isStaffOnlyAccount(ctx: AuthWorkspaceContext): boolean {
  return (
    hasAdminAccess(ctx.roleNames, ctx.permissions) &&
    !hasMarketplaceWorkspace(ctx)
  );
}
