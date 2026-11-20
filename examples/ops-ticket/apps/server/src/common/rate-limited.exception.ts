import { HttpException, HttpStatus } from '@nestjs/common';

// 429 请求太频繁（D26）。全局异常过滤器会把 retryAfterSeconds 写进 Retry-After 响应头和 error.details
export class RateLimitedException extends HttpException {
  constructor(
    readonly retryAfterSeconds: number,
    message = '请求太频繁，请稍后再试',
  ) {
    super({ code: 'RATE_LIMITED', message }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
