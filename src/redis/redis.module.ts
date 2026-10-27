import KeyvRedis from '@keyv/redis';
import { CacheModule, type CacheManagerOptions } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service.js';

/** 连接 REDIS_URL，没有配置时用本机 6379。 */
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): CacheManagerOptions => ({
        // 只传入 Redis 适配器。createKeyv 返回的 Keyv 和 CacheModule 内部的不是同一份，启动时会读不到连接地址。
        stores: [
          new KeyvRedis(
            config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379',
          ),
        ] as unknown as CacheManagerOptions['stores'],
      }),
    }),
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
