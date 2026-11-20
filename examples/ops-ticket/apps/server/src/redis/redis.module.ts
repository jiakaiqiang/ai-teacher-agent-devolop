import { RateLimitService } from './rate-limit.service.js';
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

// 全局模块（D22）：设备、权限、统计、限流都会用到
@Global()
@Module({
  providers: [RedisService, CacheService, RateLimitService],
  exports: [RedisService, CacheService, RateLimitService],
})
export class RedisModule {}
