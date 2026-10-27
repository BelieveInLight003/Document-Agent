import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/** Redis 的基本读写。ttlMs 是过期时间，单位毫秒。 */
@Injectable()
export class RedisService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  get<T>(key: string) {
    return this.cache.get<T>(key);
  }

  set(key: string, value: string, ttlMs: number) {
    return this.cache.set(key, value, ttlMs);
  }

  del(key: string) {
    return this.cache.del(key);
  }
}
