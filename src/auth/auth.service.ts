import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { EmailVerificationService } from './email-verification.service.js';
import { RoleCode } from '../user/role-code.js';
import { UserService, type UserProfile } from '../user/user.service.js';
import { UserStatus } from '../user/user-status.js';

/** 登录和令牌。用户写入交给 UserService，邮箱激活交给 EmailVerificationService。 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly emailVerification: EmailVerificationService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 注册为普通用户。邮箱必填。
   * 邮箱验证开启时，email_verified 先写 false，再发激活链接。
   * 关闭时直接写成已激活，注册后即可登录。
   */
  async register(dto: RegisterDto) {
    const verifyEmail = this.emailVerification.enabled();
    const profile = await this.userService.create(
      {
        username: dto.username,
        password: dto.password,
        email: dto.email,
        realName: dto.realName,
        roleCodes: [RoleCode.USER],
      },
      { emailVerified: !verifyEmail },
    );
    if (!verifyEmail) {
      return profile;
    }
    if (!profile.email) {
      throw new BadRequestException('邮箱不能为空');
    }
    const activationLink = await this.emailVerification.issue(
      profile.id,
      profile.email,
    );
    return {
      ...profile,
      activationLink,
    };
  }

  /**
   * 登录：查用户 → 对密码 → 确认账号启用 → 写最后登录时间 → 发两张令牌。
   * 邮箱验证开启时，未激活账号不能登录。
   * 用户不存在和密码错误返回同一句话，避免别人试出用户名是否存在。
   */
  async login(dto: LoginDto) {
    const user = await this.userService.findByUsername(dto.username);
    // 库里存的是 bcrypt 哈希，不能和明文直接比较。
    const matched =
      !!user && (await bcrypt.compare(dto.password, user.password));
    if (!user || !matched) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status !== UserStatus.ENABLED) {
      throw new UnauthorizedException('账号已禁用');
    }
    if (this.emailVerification.enabled() && !user.emailVerified) {
      throw new UnauthorizedException('邮箱未激活');
    }

    await this.userService.touchLastLogin(user);
    return await this.tokensOf(await this.userService.toProfile(user));
  }

  /**
   * 刷新：只认 refreshToken。验签通过后按里面的用户 id 再查一次库，
   * 确认人还在、账号仍启用，然后重新发 accessToken 和 refreshToken。
   */
  async refresh(dto: RefreshDto) {
    const userId = await this.userIdOfRefresh(dto.refreshToken);
    if (!userId) {
      throw new UnauthorizedException('刷新令牌无效');
    }
    const user = await this.userService.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedException('刷新令牌无效');
    }
    return await this.tokensOf(await this.userService.toProfile(user));
  }

  /**
   * 当前用户资料。令牌只提供用户 id，这里再查一次库，角色也以库里的启用角色为准。
   */
  async me(userId: string): Promise<UserProfile> {
    const user = await this.userService.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedException('未登录');
    }
    return this.userService.toProfile(user);
  }

  /** 文档审批员。账号启用，且绑定了启用中的审核员角色。 */
  listReviewers() {
    return this.userService.listByRoleCode(RoleCode.REVIEWER);
  }

  /**
   * 用刷新密钥校验 refreshToken。过期、被篡改、不是 refresh 类型，或用户 id 不是数字，都当无效。
   */
  private async userIdOfRefresh(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        type?: string;
      }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (
        payload.type !== 'refresh' ||
        !payload.sub ||
        !/^\d+$/.test(payload.sub)
      ) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * 组装登录和刷新的统一返回。
   * accessToken 用 JwtModule 里登记的密钥和有效期。
   * refreshToken 只用用户 id，密钥和有效期在这里另传。
   * expiresIn 只描述 accessToken，从令牌里的 exp、iat 算出秒数。
   */
  private async tokensOf(user: UserProfile) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
      roles: user.roles,
      type: 'access',
    });
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES') ??
          '7d') as JwtSignOptions['expiresIn'],
      },
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.expiresInOf(accessToken),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        realName: user.realName,
        roles: user.roles,
      },
    };
  }

  private expiresInOf(token: string) {
    const decoded = this.jwtService.decode(token);
    if (
      !decoded ||
      typeof decoded === 'string' ||
      decoded.exp == null ||
      decoded.iat == null
    ) {
      throw new Error('访问令牌缺少过期时间');
    }
    return decoded.exp - decoded.iat;
  }
}
