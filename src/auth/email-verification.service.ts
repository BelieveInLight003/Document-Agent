import { randomBytes } from 'node:crypto';
import { MailerService } from '@nestjs-modules/mailer';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service.js';
import { UserService } from '../user/user.service.js';

const VERIFY_TTL_MS = 10 * 60 * 1000;

/**
 * 注册邮箱激活。令牌放在 Redis，10 分钟有效。
 * 邮件发到用户注册时填写的邮箱。
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly userService: UserService,
    private readonly config: ConfigService,
  ) {}

  /**
   * EMAIL_VERIFICATION_ENABLED 不是 false 时开启。
   * 关闭后注册直接写成已激活，登录不再检查邮箱。
   */
  enabled() {
    return (
      this.config.get<string>('EMAIL_VERIFICATION_ENABLED', 'true') !== 'false'
    );
  }

  /** 生成令牌、写入 Redis，并把激活链接发到邮箱。 */
  async issue(userId: string, email: string) {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(this.tokenKey(token), userId, VERIFY_TTL_MS);
    await this.redis.set(this.userKey(userId), token, VERIFY_TTL_MS);
    const activationLink = this.activationLink(token);
    await this.mailer.sendMail({
      to: email,
      subject: '请激活你的邮箱',
      html: `<p>请在 10 分钟内打开下面的链接完成激活：</p><p><a href="${activationLink}">${activationLink}</a></p>`,
    });
    return activationLink;
  }

  /**
   * 打开激活链接。链接上的令牌和 Redis 里的记录一致时，
   * 把 email_verified 改为 true，并删掉这次注册的令牌。
   */
  async verify(token: string) {
    const tokenKey = this.tokenKey(token);
    const userId = await this.redis.get<string>(tokenKey);
    if (!userId) {
      throw new BadRequestException('激活链接无效或已过期');
    }
    const stored = await this.redis.get<string>(this.userKey(userId));
    if (stored !== token) {
      throw new BadRequestException('激活链接无效或已过期');
    }
    const user = await this.userService.markEmailVerified(userId);
    await this.redis.del(tokenKey);
    await this.redis.del(this.userKey(userId));
    return { message: '邮箱已激活', user };
  }

  private tokenKey(token: string) {
    return `auth:email-verify:${token}`;
  }

  private userKey(userId: string) {
    return `auth:email-verify-user:${userId}`;
  }

  private activationLink(token: string) {
    const base =
      this.config.get<string>('APP_PUBLIC_URL') ?? 'http://localhost:3000';
    return `${base.replace(/\/$/, '')}/auth/email/verify?token=${token}`;
  }
}
