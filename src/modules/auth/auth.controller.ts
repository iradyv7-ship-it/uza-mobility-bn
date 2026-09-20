import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipAudit } from '../../common/audit/decorators/skip-audit.decorator';
import { getRequestAuditContext } from '../../common/audit/request-context.util';
import { StorageService } from '../../common/uploads/storage.service';
import { imageMulterOptions } from '../../common/uploads/multer.config';
import { parseMultipartPayload } from '../../common/uploads/parse-payload.util';
import { multipartPayloadSchema } from '../../common/uploads/swagger-multipart.util';
import { UploadFolder } from '../../common/uploads/upload.constants';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { GoogleCompleteDto } from './dto/google-complete.dto';
import { GoogleOAuthService } from './google-oauth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { AuthService } from './auth.service';
import { StaffAccessService } from './staff-access.service';
import {
  RedeemStaffInviteDto,
  VerifyAdminLoginDto,
} from './dto/staff-access.dto';
import { UsersService } from '../../users/users.service';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import { extractBearerToken } from './utils/extract-bearer-token.util';
import type { AuthenticatedRequest } from '../../users/users.types';
import type { Request } from 'express';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiOkResponse({ type: RegisterResponseDto })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, getRequestAuditContext(request));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, getRequestAuditContext(request));
  }

  @Get('google')
  @Public()
  @SkipAudit()
  @ApiOperation({
    summary:
      'Start Google OAuth (redirects to Google — uses client secret on callback)',
  })
  startGoogleOAuth(
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ) {
    if (!this.googleOAuthService.isConfigured()) {
      return response.redirect(
        this.googleOAuthService.buildFrontendErrorUrl(
          'Google sign-in is not configured',
          returnTo,
        ),
      );
    }

    const url = this.googleOAuthService.getAuthorizationUrl(returnTo);
    return response.redirect(url);
  }

  @Get('google/callback')
  @Public()
  @SkipAudit()
  @ApiOperation({
    summary: 'Google OAuth callback — exchanges code with client secret',
  })
  async googleOAuthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    if (error) {
      return response.redirect(
        this.googleOAuthService.buildFrontendErrorUrl(
          'Google sign-in was cancelled',
        ),
      );
    }

    if (!code || !state) {
      return response.redirect(
        this.googleOAuthService.buildFrontendErrorUrl(
          'Missing Google authorization response',
        ),
      );
    }

    try {
      const result = await this.googleOAuthService.exchangeAuthorizationCode(
        code,
        state,
      );
      return response.redirect(
        this.googleOAuthService.buildFrontendCallbackUrl(
          result.exchangeCode,
          result.returnTo,
        ),
      );
    } catch {
      return response.redirect(
        this.googleOAuthService.buildFrontendErrorUrl(
          'Unable to complete Google sign-in',
        ),
      );
    }
  }

  @Post('google/complete')
  @Public()
  @SkipAudit()
  @ApiOperation({
    summary: 'Finish Google sign-in after OAuth callback redirect',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  completeGoogleOAuth(@Body() dto: GoogleCompleteDto, @Req() request: Request) {
    const profile = this.googleOAuthService.consumePendingExchange(dto.code);
    return this.authService.loginWithGoogleProfile(
      profile,
      getRequestAuditContext(request),
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/login')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Login an admin user with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  loginAdmin(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.loginAdmin(dto, getRequestAuditContext(request));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admin/login/verify')
  @Public()
  @SkipAudit()
  @ApiOperation({
    summary:
      'Second step of an admin sign-in: the one-time code from the email, in exchange for tokens',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  verifyAdminLogin(
    @Body() dto: VerifyAdminLoginDto,
    @Req() request: Request,
  ) {
    return this.authService.verifyAdminLogin(
      dto.challengeId,
      dto.code,
      getRequestAuditContext(request),
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('staff-invites/redeem')
  @ApiOperation({
    summary:
      'Redeem a staff access code from the signed-in account; grants the invited roles once',
  })
  redeemStaffInvite(
    @Body() dto: RedeemStaffInviteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.staffAccess.redeemInvite(userId, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiOkResponse({ type: MessageResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Verify email address using a verification token' })
  @ApiOkResponse({ type: MessageResponseDto })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Resend email verification link by email address' })
  @ApiOkResponse({ type: MessageResponseDto })
  resendVerification(
    @Body() dto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.authService.resendVerificationByEmail(dto.email);
  }

  @Post('me/resend-verification')
  @SkipAudit()
  @ApiBearerAuth('JWT-access')
  @ApiOperation({
    summary: 'Resend email verification link for the signed-in user',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async resendVerificationForMe(
    @Req() request: AuthenticatedRequest,
  ): Promise<MessageResponseDto> {
    if (!request.user?.sub) {
      throw new UnauthorizedException('Unauthenticated');
    }

    return this.authService.resendVerificationForUser(request.user.sub);
  }

  @Post('refresh')
  @Public()
  @ApiBearerAuth('JWT-refresh')
  @ApiOperation({
    summary: 'Refresh access token (use refresh token in Authorization header)',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(
    @Headers('authorization') authHeader: string,
  ): Promise<AuthResponseDto> {
    const token = extractBearerToken(authHeader, 'refresh token');
    return this.authService.refresh(token);
  }

  @Post('logout')
  @Public()
  @SkipAudit()
  @ApiBearerAuth('JWT-refresh')
  @ApiOperation({ summary: 'Logout by invalidating the refresh token' })
  @ApiOkResponse({ description: 'Refresh token invalidated' })
  async logout(
    @Headers('authorization') authHeader: string,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    const token = extractBearerToken(authHeader, 'refresh token');
    await this.authService.logout(token, getRequestAuditContext(request));
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiBearerAuth('JWT-access')
  @ApiOperation({
    summary: 'Get current session profile',
    description:
      'Returns user fields, roles, effective permissions (from DB), buyerProfile, and seller.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  async me(@Req() request: AuthenticatedRequest): Promise<MeResponseDto> {
    if (!request.user?.sub) {
      throw new UnauthorizedException('Unauthenticated');
    }

    return this.authService.me(request.user.sub);
  }

  @Patch('me')
  @SkipAudit()
  @ApiBearerAuth('JWT-access')
  @UseInterceptors(FileInterceptor('photo', imageMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: multipartPayloadSchema(
      {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Profile photo',
        },
      },
      [],
    ),
  })
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ type: MeResponseDto })
  async updateMe(
    @Req() request: AuthenticatedRequest,
    @Body('payload') payload: string | undefined,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<MeResponseDto> {
    if (!request.user?.sub) {
      throw new UnauthorizedException('Unauthenticated');
    }

    const dto = payload?.trim()
      ? await parseMultipartPayload(UpdateUserDto, payload)
      : {};

    let previousPhoto: string | null | undefined;
    if (photo) {
      const current = await this.authService.me(request.user.sub);
      previousPhoto = current.profilePhoto;
    }

    const profilePhoto = photo
      ? (await this.storage.uploadImage(photo, UploadFolder.PROFILES)).url
      : undefined;

    await this.usersService.updateMe(
      request.user.sub,
      {
        ...dto,
        ...(profilePhoto ? { profilePhoto } : {}),
      },
      getRequestAuditContext(request),
    );

    if (profilePhoto && previousPhoto) {
      await this.storage.deleteByUrl(previousPhoto);
    }

    return this.authService.me(request.user.sub);
  }
}
