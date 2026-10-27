import { randomInt, timingSafeEqual } from 'node:crypto';
import { MailerService } from '@nestjs-modules/mailer';
import { BadRequestException, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { UserService } from '../user/user.service.js';

const RESET_TTL_MS = 10 * 60 * 1000;

const SENT_MESSAGE = '如果该邮箱已注册，验证码已发送到邮箱';

/**
 * 忘记密码。6 位数字验证码放在 Redis，10 分钟有效，发到用户注册邮箱。
 * 新密码和验证码一起提交，邮件里没有重置链接。
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly userService: UserService,
  ) {}

  /**
   * 按邮箱发验证码。邮箱未注册时也返回同一句话，避免试出邮箱是否存在。
   * 同一用户再次申请时，上一组验证码作废。
   */
  async request(email: string) {
    const user = await this.userService.findByEmail(email);
    if (!user?.email) {
      return { message: SENT_MESSAGE };
    }
    await this.issue(user.id.toString(), user.email);
    return { message: SENT_MESSAGE };
  }

  /**
   * 提交邮箱里的验证码和新密码。验证码和 Redis 记录一致时更新密码，并删掉这次的验证码。
   */
  async reset(email: string, code: string, password: string) {
    const user = await this.userService.findByEmail(email);
    const userId = user?.id.toString();
    const stored = userId
      ? await this.redis.get<string>(this.userKey(userId))
      : null;
    if (!userId || !stored || !this.sameCode(stored, code)) {
      throw new BadRequestException('验证码无效或已过期');
    }
    await this.userService.resetPassword(userId, password);
    await this.redis.del(this.userKey(userId));
    return { message: '密码已重置' };
  }

  private async issue(userId: string, email: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(this.userKey(userId), code, RESET_TTL_MS);
    await this.mailer.sendMail({
      to: email,
      subject: '重置你的密码',
      html: `<p>请在 10 分钟内使用下面的验证码重置密码：</p><p>${code}</p>`,
    });
  }

  private userKey(userId: string) {
    return `auth:password-reset-user:${userId}`;
  }

  private sameCode(stored: string, code: string) {
    const left = Buffer.from(stored);
    const right = Buffer.from(code);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }
}
