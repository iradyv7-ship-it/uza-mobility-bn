import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { PLATFORM_STAFF_ROLES } from './auth-workspace.util';
import { hashToken } from './auth-token.util';

/**
 * What makes the staff surfaces exclusive to employees.
 *
 * Two mechanisms, both one-time codes:
 *
 *  1. **Staff invites.** A role is never self-assigned. A super admin issues an invite to a
 *     named email with the roles it should carry; the code is shown once and emailed when
 *     mail is on. The employee signs in however they like — Google or a password — which
 *     makes them a *client*; redeeming the code, from the account with that exact email,
 *     is what makes them staff. Expired, revoked or already-used codes are dead.
 *
 *  2. **Admin login challenge.** A correct password on the admin panel does not open it.
 *     It opens a ten-minute, five-attempt challenge: a six-digit code sent to the
 *     account's email, verified on a second call, which is what issues the tokens.
 *
 * When mail is not configured (local, simulation), the code is logged to the server and,
 * outside production, echoed in the response as `devCode` — so a developer can still get in
 * without the check being silently skipped in production.
 */
@Injectable()
export class StaffAccessService {
  private readonly logger = new Logger(StaffAccessService.name);
  static readonly INVITE_TTL_HOURS = 72;
  static readonly CHALLENGE_TTL_MINUTES = 10;
  static readonly CHALLENGE_MAX_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  // ── Invites ───────────────────────────────────────────────────────────────────────────

  /** UZA-XXXX-XXXX from an unambiguous alphabet (no 0/O, 1/I). */
  private static newInviteCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    return `UZA-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  }

  private static normaliseCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, '');
  }

  async createInvite(input: {
    email: string;
    roles: string[];
    note?: string;
    byUserId: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const roles = Array.from(new Set(input.roles.map((r) => r.trim().toUpperCase())));
    if (!roles.length) throw new BadRequestException('At least one role is required.');
    const unknown = roles.filter(
      (r) => !(PLATFORM_STAFF_ROLES as readonly string[]).includes(r) && !r.startsWith('LENDER_'),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Not a staff or lender role: ${unknown.join(', ')}. Staff roles: ${PLATFORM_STAFF_ROLES.join(', ')}; lender roles are LENDER_<KEY>.`,
      );
    }
    const existing = await this.prisma.role.findMany({ where: { name: { in: roles } }, select: { name: true } });
    const missing = roles.filter((r) => !existing.some((e) => e.name === r));
    if (missing.length) throw new BadRequestException(`Role not seeded: ${missing.join(', ')}`);

    // One live invite per email: issuing a new one revokes the old.
    await this.prisma.staffInvite.updateMany({
      where: { email, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const code = StaffAccessService.newInviteCode();
    const invite = await this.prisma.staffInvite.create({
      data: {
        email,
        roles,
        codeHash: hashToken(code),
        note: input.note?.trim() || null,
        expiresAt: new Date(Date.now() + StaffAccessService.INVITE_TTL_HOURS * 3_600_000),
        createdByUserId: input.byUserId,
      },
    });

    await this.audit.record({
      userId: input.byUserId,
      action: 'STAFF_INVITE_ISSUED',
      entity: 'staff_invite',
      entityId: invite.id,
      metadata: { email, roles, expiresAt: invite.expiresAt.toISOString() },
    });

    const adminUrl = this.config.get<string>('ADMIN_FRONTEND_URL') ?? '';
    let emailed = false;
    if (this.mail.isEnabled()) {
      await this.mail.sendMail({
        to: email,
        subject: 'Your UZA staff access code',
        text: `You have been invited to UZA Mobility staff as ${roles.join(', ')}.\n\nSign in (Google or password) with this email address, then enter this code when asked:\n\n    ${code}\n\nIt expires in ${StaffAccessService.INVITE_TTL_HOURS} hours and works once.${adminUrl ? `\n\nAdmin panel: ${adminUrl}` : ''}`,
        html: `<p>You have been invited to UZA Mobility staff as <b>${roles.join(', ')}</b>.</p><p>Sign in (Google or password) with this email address, then enter this code when asked:</p><p style="font-size:24px;letter-spacing:2px"><b>${code}</b></p><p>It expires in ${StaffAccessService.INVITE_TTL_HOURS} hours and works once.</p>${adminUrl ? `<p>Admin panel: <a href="${adminUrl}">${adminUrl}</a></p>` : ''}`,
      });
      emailed = true;
    }

    return {
      id: invite.id,
      email,
      roles,
      expiresAt: invite.expiresAt,
      emailed,
      /** Shown once. Not stored. */
      code,
    };
  }

  async listInvites() {
    const rows = await this.prisma.staffInvite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      roles: r.roles,
      note: r.note,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt,
      revokedAt: r.revokedAt,
      status: r.usedAt ? 'USED' : r.revokedAt ? 'REVOKED' : r.expiresAt.getTime() < now ? 'EXPIRED' : 'OPEN',
    }));
  }

  async revokeInvite(id: string, byUserId: string) {
    const inv = await this.prisma.staffInvite.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invite not found');
    if (inv.usedAt) throw new BadRequestException('Already redeemed; remove the roles from the user instead.');
    await this.prisma.staffInvite.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ userId: byUserId, action: 'STAFF_INVITE_REVOKED', entity: 'staff_invite', entityId: id, metadata: { email: inv.email } });
    return { revoked: true };
  }

  /** Redeem from the signed-in account. The account's email must be the invited one. */
  async redeemInvite(userId: string, rawCode: string) {
    const code = StaffAccessService.normaliseCode(rawCode);
    if (!/^UZA-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
      throw new BadRequestException('That is not a staff access code.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isEmailVerified: true } });
    if (!user) throw new UnauthorizedException();
    const inv = await this.prisma.staffInvite.findUnique({ where: { codeHash: hashToken(code) } });
    // One message for every failure: a code must not reveal whether it exists.
    const refuse = () => new ForbiddenException('This code is not valid for this account, or has expired.');
    if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) throw refuse();
    if (inv.email !== user.email.toLowerCase()) throw refuse();
    if (!user.isEmailVerified) {
      throw new ForbiddenException('Verify your email address first, then redeem the code.');
    }

    for (const role of inv.roles) await this.users.ensureRoleAdded(user.id, role);
    await this.prisma.staffInvite.update({ where: { id: inv.id }, data: { usedAt: new Date(), usedByUserId: user.id } });
    await this.audit.record({
      userId: user.id,
      action: 'STAFF_INVITE_REDEEMED',
      entity: 'staff_invite',
      entityId: inv.id,
      metadata: { roles: inv.roles, issuedBy: inv.createdByUserId },
    });
    return { roles: inv.roles };
  }

  // ── Admin login challenge ─────────────────────────────────────────────────────────────

  async openChallenge(input: { userId: string; email: string; ipAddress?: string; userAgent?: string }) {
    // Any earlier open challenge for this user is dead the moment a new one is issued.
    await this.prisma.adminLoginChallenge.updateMany({
      where: { userId: input.userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ch = await this.prisma.adminLoginChallenge.create({
      data: {
        userId: input.userId,
        // Salted with the challenge id so equal codes never share a hash across rows.
        codeHash: '',
        expiresAt: new Date(Date.now() + StaffAccessService.CHALLENGE_TTL_MINUTES * 60_000),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    await this.prisma.adminLoginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashToken(`${ch.id}:${code}`) } });

    let delivered: 'email' | 'log' = 'log';
    if (this.mail.isEnabled()) {
      await this.mail.sendMail({
        to: input.email,
        subject: `${code} is your UZA admin sign-in code`,
        text: `Your UZA admin sign-in code is ${code}. It expires in ${StaffAccessService.CHALLENGE_TTL_MINUTES} minutes. If you did not try to sign in, change your password now.`,
        html: `<p>Your UZA admin sign-in code is</p><p style="font-size:28px;letter-spacing:4px"><b>${code}</b></p><p>It expires in ${StaffAccessService.CHALLENGE_TTL_MINUTES} minutes. If you did not try to sign in, change your password now.</p>`,
      });
      delivered = 'email';
    } else {
      this.logger.warn(`Mail is off — admin sign-in code for ${input.email}: ${code}`);
    }

    const [local, domain] = input.email.split('@');
    return {
      challengeId: ch.id,
      otpRequired: true as const,
      expiresAt: ch.expiresAt,
      deliveredTo: `${local.slice(0, 2)}…@${domain}`,
      delivered,
      devCode: !this.isProduction && delivered === 'log' ? code : undefined,
    };
  }

  /** Returns the userId the challenge was for; throws otherwise. */
  async verifyChallenge(challengeId: string, rawCode: string): Promise<string> {
    const code = rawCode.replace(/\D/g, '');
    const ch = await this.prisma.adminLoginChallenge.findUnique({ where: { id: challengeId } });
    const refuse = (why: string) => new UnauthorizedException(why);
    if (!ch || ch.consumedAt) throw refuse('This sign-in code has already been used. Sign in again.');
    if (ch.expiresAt.getTime() < Date.now()) throw refuse('This sign-in code has expired. Sign in again.');
    if (ch.attempts >= StaffAccessService.CHALLENGE_MAX_ATTEMPTS) {
      throw refuse('Too many attempts. Sign in again to get a new code.');
    }
    const expected = Buffer.from(ch.codeHash, 'hex');
    const given = Buffer.from(hashToken(`${ch.id}:${code}`), 'hex');
    const ok = code.length === 6 && expected.length === given.length && timingSafeEqual(expected, given);
    if (!ok) {
      const u = await this.prisma.adminLoginChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      const left = StaffAccessService.CHALLENGE_MAX_ATTEMPTS - u.attempts;
      throw refuse(left > 0 ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many attempts. Sign in again to get a new code.');
    }
    await this.prisma.adminLoginChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    return ch.userId;
  }
}
