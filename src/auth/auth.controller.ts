import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { UserProfile } from '../user/user.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './public.decorator.js';

/** 注册和登录。新用户绑定普通用户。 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
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

  /** 当前登录用户。令牌守卫已经查过库，这里直接返回。 */
  @Get('me')
  me(@Req() request: Request & { user: UserProfile }) {
    return request.user;
  }

  /** 文档审批员列表。账号启用，且绑定了启用中的审核员角色。 */
  @Get('reviewer-ids')
  reviewerIds() {
    return this.authService.listReviewers();
  }
}
