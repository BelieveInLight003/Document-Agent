import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PermissionModule } from '../permission/permission.module.js';
import { PermissionsGuard } from '../permission/permission.guard.js';
import { RedisModule } from '../redis/redis.module.js';
import { UserModule } from '../user/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [
    UserModule,
    PermissionModule,
    RedisModule,
    PassportModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = Number(config.get<string>('MAIL_PORT') ?? 465);
        const secure =
          (config.get<string>('MAIL_SECURE') ?? String(port === 465)) ===
          'true';
        return {
          transport: {
            host: config.get<string>('MAIL_HOST'),
            port,
            secure,
            auth: {
              user: config.get<string>('MAIL_USER'),
              pass: config.get<string>('MAIL_PASS'),
            },
          },
          defaults: {
            from:
              config.get<string>('MAIL_FROM') ??
              config.get<string>('MAIL_USER'),
          },
        };
      },
    }),
    // accessToken 用模块里的密钥和有效期。refreshToken 在签发时另传密钥。
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES') ??
            '2h') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    PasswordResetService,
    JwtStrategy,
    // 先校验令牌，再校验角色，最后校验权限。APP_GUARD 对全部接口生效。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
