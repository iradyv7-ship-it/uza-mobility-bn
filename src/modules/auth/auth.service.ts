import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthTokenType, SellerType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { StaffAccessService } from './staff-access.service';
import { compareSync, genSaltSync, hashSync } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { UsersService } from '../../users/users.service';
import { SafeUser } from '../../users/users.types';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import type { MeResponseDto } from './dto/me-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RbacService } from './rbac.service';
import {
  hasAdminAccess,
  isStaffOnlyAccount,
  type AuthWorkspaceContext,
} from './auth-workspace.util';
import { normalizeAuthEmail } from './auth-email.util';
import {
  generateRawToken,
  hashToken,
  parseDurationToMs,
} from './auth-token.util';
import { MailService } from '../../common/mail/mail.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { SignOptions } from 'jsonwebtoken';

/** Single public login failure message — avoids account-type enumeration. */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

const FORGOT_PASSWORD_MESSAGE =
  'If this email is registered, we have sent you a link to reset your password. Please check your inbox and spam folder.';

const RESEND_VERIFICATION_MESSAGE =
  'If this email is registered and still needs verification, we have sent a new link. Please check your inbox and spam folder.';

const EMAIL_NOT_VERIFIED_MESSAGE =
  'Your email is not verified yet. Please check your inbox for the verification email or request a new verification link.';

const LINK_EXISTING_GOOGLE_ACCOUNT_MESSAGE =
  'Check your email for a link to finish setting up sign-in with email and password. You can also use Google sign-in with this address.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly moduleRef: ModuleRef,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async register(
    dto: RegisterDto,
    auditContext: RequestAuditContext = {},
  ): Promise<RegisterResponseDto> {
    const email = normalizeAuthEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: { include: { role: true } },
        sellers: { select: { sellerType: true } },
        operatorProfile: { select: { id: true } },
      },
    });

    if (existingUser && !existingUser.deletedAt && existingUser.isActive) {
      if (existingUser.googleId) {
        return this.linkGoogleAccountToEmailPassword(
          existingUser,
          dto,
          auditContext,
        );
      }

      throw new ConflictException('Email already in use');
    }

    const passwordHash = this.hashPassword(dto.password);
    const createdUser = await this.usersService.createUser({
      email,
      phone: dto.phone,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      preferredLanguage: dto.preferredLanguage ?? 'en',
      roles: {
        create: [
          {
            role: {
              connect: { name: 'BUYER' },
            },
          },
        ],
      },
    });

    await this.linkGuestActivityToUser(createdUser.id, email);

    await this.auditService.record({
      userId: createdUser.id,
      action: 'auth:register',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        email: createdUser.email,
      },
    });

    await this.sendVerificationEmailForUser(createdUser.id);

    return {
      message:
        'Account created. Check your email to verify your account before signing in.',
      email: createdUser.email,
    };
  }

  async login(
    dto: LoginDto,
    auditContext: RequestAuditContext = {},
  ): Promise<AuthResponseDto> {
    return this.authenticateAndIssueTokens(dto, auditContext);
  }

  async loginWithGoogleProfile(
    profile: {
      email: string;
      googleId: string;
      firstName: string;
      lastName: string;
      emailVerified: boolean;
    },
    auditContext: RequestAuditContext = {},
  ): Promise<AuthResponseDto> {
    const email = profile.email.trim().toLowerCase();
    const googleId = profile.googleId;
    const firstName = profile.firstName;
    const lastName = profile.lastName;

    const userInclude = {
      roles: { include: { role: true } },
      sellers: { select: { sellerType: true } },
      operatorProfile: { select: { id: true } },
    } as const;

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email }],
        deletedAt: null,
      },
      include: userInclude,
    });

    if (!user) {
      const passwordHash = this.hashPassword(randomBytes(32).toString('hex'));
      user = await this.prisma.user.create({
        data: {
          email,
          googleId,
          passwordHash,
          firstName,
          lastName,
          isEmailVerified: profile.emailVerified,
          roles: {
            create: [{ role: { connect: { name: 'BUYER' } } }],
          },
        },
        include: userInclude,
      });

      await this.linkGuestActivityToUser(user.id, email);

      await this.auditService.record({
        userId: user.id,
        action: 'auth:google-register',
        entity: 'User',
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        metadata: { email },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: user.googleId ?? googleId,
          isEmailVerified: user.isEmailVerified || profile.emailVerified,
          firstName: user.firstName || firstName,
          lastName: user.lastName || lastName,
        },
        include: userInclude,
      });

      await this.linkGuestActivityToUser(user.id, email);
    }

    this.assertUserIsActive(user);

    const roleNames = user.roles.map((role) => role.role.name);
    const permissions =
      await this.rbacService.resolvePermissionsForRoleNames(roleNames);
    const workspaceContext = {
      roleNames,
      permissions,
      sellers: user.sellers,
      hasOperatorProfile: user.operatorProfile != null,
    };

    if (isStaffOnlyAccount(workspaceContext)) {
      throw new UnauthorizedException(
        'Use the admin portal to sign in with this account',
      );
    }

    const safeUser = this.usersService.toSafeUser(user);
    const tokens = await this.issueTokens(safeUser);

    await this.auditService.record({
      userId: safeUser.id,
      action: 'auth:google-login',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: { email: safeUser.email },
    });

    return tokens;
  }

  /**
   * Step one of an admin sign-in. A correct password does not issue tokens; it opens a
   * one-time-code challenge delivered to the account's email (StaffAccessService). Step two
   * is `verifyAdminLogin`. The same wrong-credentials message covers every failure here.
   */
  async loginAdmin(dto: LoginDto, auditContext: RequestAuditContext = {}) {
    const user = await this.authenticate(dto, { adminOnly: true });
    await this.auditService.record({
      userId: user.id,
      action: 'auth:admin-login-challenge',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: { email: user.email },
    });
    return this.staffAccess.openChallenge({
      userId: user.id,
      email: user.email,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
  }

  async verifyAdminLogin(
    challengeId: string,
    code: string,
    auditContext: RequestAuditContext = {},
  ): Promise<AuthResponseDto> {
    const userId = await this.staffAccess.verifyChallenge(challengeId, code);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        sellers: { select: { sellerType: true } },
        operatorProfile: { select: { id: true } },
      },
    });
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    this.assertUserIsActive(user);
    const roleNames = user.roles.map((r) => r.role.name);
    const permissions =
      await this.rbacService.resolvePermissionsForRoleNames(roleNames);
    if (!hasAdminAccess(roleNames, permissions)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const safeUser = this.usersService.toSafeUser(user);
    const tokens = await this.issueTokens(safeUser);
    await this.auditService.record({
      userId: safeUser.id,
      action: 'auth:admin-login',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: { email: safeUser.email, challengeId },
    });
    return tokens;
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    let payload: Record<string, unknown>;

    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (
      !tokenRecord ||
      tokenRecord.userId !== payload.sub ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    this.assertUserIsActive(tokenRecord.user);
    this.assertEmailVerified(tokenRecord.user);

    return this.issueTokens(this.usersService.toSafeUser(tokenRecord.user));
  }

  async logout(
    refreshToken: string,
    auditContext: RequestAuditContext = {},
  ): Promise<void> {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: { select: { email: true } },
      },
    });

    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    if (tokenRecord) {
      await this.auditService.record({
        userId: tokenRecord.userId,
        action: 'auth:logout',
        entity: 'User',
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        metadata: {
          email: tokenRecord.user.email,
        },
      });
    }
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalizedEmail = normalizeAuthEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        roles: { include: { role: true } },
        sellers: { select: { sellerType: true } },
        operatorProfile: { select: { id: true } },
      },
    });

    if (user && user.isActive && !user.deletedAt) {
      const roleNames = user.roles.map((role) => role.role.name);
      const permissions =
        await this.rbacService.resolvePermissionsForRoleNames(roleNames);
      const workspaceContext: AuthWorkspaceContext = {
        roleNames,
        permissions,
        sellers: user.sellers,
        hasOperatorProfile: user.operatorProfile != null,
      };

      await this.sendPasswordResetEmail(user, workspaceContext);
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ message: string }> {
    const record = await this.findValidAuthToken(
      token,
      AuthTokenType.PASSWORD_RESET,
    );

    const passwordHash = this.hashPassword(password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { userId: record.userId },
      }),
    ]);

    return { message: 'Password updated successfully' };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const record = await this.findValidAuthToken(
      token,
      AuthTokenType.EMAIL_VERIFICATION,
    );

    if (record.user.isEmailVerified) {
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await this.linkGuestActivityToUser(record.userId, record.user.email);
      return { message: 'Email is already verified' };
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { isEmailVerified: true },
      }),
      this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.linkGuestActivityToUser(record.userId, record.user.email);

    return { message: 'Email verified successfully' };
  }

  async resendVerificationByEmail(email: string): Promise<{ message: string }> {
    const normalizedEmail = normalizeAuthEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user && !user.isEmailVerified && user.isActive && !user.deletedAt) {
      await this.sendVerificationEmailForUser(user.id);
    }

    return { message: RESEND_VERIFICATION_MESSAGE };
  }

  async resendVerificationForUser(
    userId: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.isEmailVerified || !user.isActive || user.deletedAt) {
      return { message: RESEND_VERIFICATION_MESSAGE };
    }

    await this.sendVerificationEmailForUser(user.id);
    return { message: RESEND_VERIFICATION_MESSAGE };
  }

  async me(userId: string): Promise<MeResponseDto> {
    const profile = await this.usersService.getMeProfile(userId);
    const permissions = await this.rbacService.resolvePermissionsForRoleNames(
      profile.roles,
    );

    return {
      ...profile,
      permissions,
    };
  }

  private async issueTokens(user: SafeUser): Promise<AuthResponseDto> {
    const permissions = await this.rbacService.resolvePermissionsForRoleNames(
      user.roles,
    );
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions,
      tokenType: 'access',
    });

    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        permissions,
        tokenType: 'refresh',
      },
      {
        expiresIn: refreshExpiresIn as SignOptions['expiresIn'],
      },
    );

    /*
     * `decode()` does not verify and its return type is `any`, so nothing here can
     * be trusted on shape. We only want `exp`, and only to record when this token
     * stops being valid — the token itself was just signed by us, so a missing or
     * malformed `exp` means our own signing options changed, not an attack.
     *
     * Falling back to "now" is deliberate: a row that looks already-expired is
     * cleaned up on the next sweep, whereas defaulting far into the future would
     * leave a refresh token that outlives its own signature.
     */
    const refreshPayload: unknown = this.jwtService.decode(refreshToken);
    const exp =
      typeof refreshPayload === 'object' &&
      refreshPayload !== null &&
      'exp' in refreshPayload &&
      typeof refreshPayload.exp === 'number'
        ? (refreshPayload as { exp: number }).exp
        : Math.floor(Date.now() / 1000);
    const refreshExpiresAt = new Date(exp * 1000);

    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private async authenticateAndIssueTokens(
    dto: LoginDto,
    auditContext: RequestAuditContext = {},
    options: {
      adminOnly?: boolean;
      auditAction?: string;
    } = {},
  ): Promise<AuthResponseDto> {
    const safeUser = await this.authenticate(dto, options);
    await this.linkGuestActivityToUser(safeUser.id, safeUser.email);
    const tokens = await this.issueTokens(safeUser);

    await this.auditService.record({
      userId: safeUser.id,
      action: options.auditAction ?? 'auth:login',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        email: safeUser.email,
      },
    });

    return tokens;
  }

  /** Password + account checks + workspace check. Issues nothing. */
  private async authenticate(
    dto: LoginDto,
    options: { adminOnly?: boolean } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeAuthEmail(dto.email) },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        sellers: { select: { sellerType: true } },
        operatorProfile: { select: { id: true } },
      },
    });

    if (!user || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    this.assertUserIsActive(user);
    this.assertEmailVerified(user);

    const roleNames = user.roles.map((role) => role.role.name);
    const permissions =
      await this.rbacService.resolvePermissionsForRoleNames(roleNames);
    const workspaceContext = {
      roleNames,
      permissions,
      sellers: user.sellers,
      hasOperatorProfile: user.operatorProfile != null,
    };

    if (
      (options.adminOnly && !hasAdminAccess(roleNames, permissions)) ||
      (!options.adminOnly && isStaffOnlyAccount(workspaceContext))
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.usersService.toSafeUser(user);
  }

  private assertUserIsActive(user: {
    isActive: boolean;
    deletedAt: Date | null;
  }): void {
    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
  }

  private assertEmailVerified(user: { isEmailVerified: boolean }): void {
    if (!user.isEmailVerified) {
      throw new UnauthorizedException(EMAIL_NOT_VERIFIED_MESSAGE);
    }
  }

  /**
   * Attach guest-submitted records (same email, no user yet) to a signed-in user.
   * Inquiries and fleet requests are linked immediately; buy inquiries become
   * invoices once the buyer profile exists (see fulfillPendingBuyInquiries).
   */
  private async linkGuestActivityToUser(
    userId: string,
    email: string,
  ): Promise<void> {
    const normalized = normalizeAuthEmail(email);

    await Promise.all([
      this.prisma.inquiry.updateMany({
        where: { email: normalized, userId: null },
        data: { userId },
      }),
      this.prisma.fleetRequest.updateMany({
        where: { email: normalized, userId: null },
        data: { userId },
      }),
    ]);

    const invoicesService = this.moduleRef.get(InvoicesService, {
      strict: false,
    });
    await invoicesService?.fulfillPendingBuyInquiries(userId);
  }

  private async linkGoogleAccountToEmailPassword(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      googleId: string | null;
      roles: Array<{ role: { name: string } }>;
      sellers: Array<{ sellerType: SellerType }>;
      operatorProfile: { id: string } | null;
    },
    dto: RegisterDto,
    auditContext: RequestAuditContext,
  ): Promise<RegisterResponseDto> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        phone: user.phone ?? dto.phone,
        firstName: user.firstName || dto.firstName,
        lastName: user.lastName || dto.lastName,
      },
    });

    await this.linkGuestActivityToUser(user.id, user.email);

    const roleNames = user.roles.map((role) => role.role.name);
    const permissions =
      await this.rbacService.resolvePermissionsForRoleNames(roleNames);
    const workspaceContext: AuthWorkspaceContext = {
      roleNames,
      permissions,
      sellers: user.sellers,
      hasOperatorProfile: user.operatorProfile != null,
    };

    await this.sendPasswordResetEmail(user, workspaceContext);

    await this.auditService.record({
      userId: user.id,
      action: 'auth:link-google-to-password',
      entity: 'User',
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: { email: user.email },
    });

    return {
      message: LINK_EXISTING_GOOGLE_ACCOUNT_MESSAGE,
      email: user.email,
      linkedExistingAccount: true,
    };
  }

  private hashPassword(password: string): string {
    const salt = genSaltSync(10);
    return hashSync(password, salt);
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    return compareSync(password, storedHash);
  }

  private async sendVerificationEmailForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.isEmailVerified || !user.isActive || user.deletedAt) {
      return;
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() +
        parseDurationToMs(
          this.configService.get<string>('EMAIL_VERIFICATION_EXPIRES_IN'),
          24 * 60 * 60 * 1000,
        ),
    );

    await this.prisma.authToken.deleteMany({
      where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
    });

    await this.prisma.authToken.create({
      data: {
        userId,
        tokenHash,
        type: AuthTokenType.EMAIL_VERIFICATION,
        expiresAt,
      },
    });

    const appName =
      this.configService.get<string>('APP_NAME') ?? 'UZA Mobility';
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const verifyUrl = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(rawToken)}`;

    await this.mailService.sendMail({
      to: user.email,
      subject: `Verify your ${appName} email`,
      html: this.mailService.buildVerifyEmailHtml({
        appName,
        firstName: user.firstName,
        verifyUrl,
      }),
      text: `Verify your email: ${verifyUrl}`,
    });
  }

  private async sendPasswordResetEmail(
    user: {
      id: string;
      email: string;
      firstName: string;
    },
    workspaceContext: AuthWorkspaceContext,
  ): Promise<void> {
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() +
        parseDurationToMs(
          this.configService.get<string>('PASSWORD_RESET_EXPIRES_IN'),
          60 * 60 * 1000,
        ),
    );

    await this.prisma.authToken.deleteMany({
      where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET },
    });

    await this.prisma.authToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: AuthTokenType.PASSWORD_RESET,
        expiresAt,
      },
    });

    const appName =
      this.configService.get<string>('APP_NAME') ?? 'UZA Mobility';
    const marketplaceUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const adminUrl =
      this.configService.get<string>('ADMIN_FRONTEND_URL') ??
      'http://localhost:3001';
    const baseUrl = isStaffOnlyAccount(workspaceContext)
      ? adminUrl
      : marketplaceUrl;
    const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;

    await this.mailService.sendMail({
      to: user.email,
      subject: `Reset your ${appName} password`,
      html: this.mailService.buildResetPasswordHtml({
        appName,
        firstName: user.firstName,
        resetUrl,
      }),
      text: `Reset your password: ${resetUrl}`,
    });
  }

  private async findValidAuthToken(token: string, type: AuthTokenType) {
    const tokenHash = hashToken(token);
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !record ||
      record.type !== type ||
      record.usedAt ||
      record.expiresAt < new Date() ||
      !record.user.isActive ||
      record.user.deletedAt
    ) {
      throw new BadRequestException('Invalid or expired link');
    }

    return record;
  }
}
