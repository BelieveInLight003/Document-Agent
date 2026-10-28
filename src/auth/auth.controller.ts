import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import type { UserProfile } from '../user/user.service.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { UserPermissionService } from '../permission/user-permission.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { Public } from './public.decorator.js';

/** 注册和登录。新用户绑定普通用户。 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly userPermissions: UserPermissionService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** 点开注册返回的链接，核对 Redis 令牌后激活邮箱。 */
  @Public()
  @Get('email/verify')
  verifyEmail(@Query() query: VerifyEmailDto) {
    return this.emailVerification.verify(query.token);
  }

  /** 按注册邮箱发 6 位验证码。未注册也返回同一句话。 */
  @Public()
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.request(dto.email);
  }

  /** 用邮箱里的验证码和新密码覆盖原密码。 */
  @Public()
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordReset.reset(dto.email, dto.code, dto.password);
  }

  /** 校验用户名和密码，更新最后登录时间。 */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** 用 refreshToken 换新的 accessToken 和 refreshToken。 */
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * 当前登录用户。
   * permissionList 是启用角色上的权限和直接授予的权限合并后的列表。
   */
  @Get('me')
  async me(@Req() request: Request & { user: UserProfile }) {
    const merged = await this.userPermissions.listMerged(request.user.id);
    return {
      ...request.user,
      permissionList: merged.permissions,
    };
  }

  /** 文档审批员列表。账号启用，且绑定了启用中的审核员角色。 */
  @Get('reviewer-ids')
  reviewerIds() {
    return this.authService.listReviewers();
  }
}
