import {
  SetMetadata,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

// 成功响应统一包一层 data，前端只按一种结构解析
export const RawResponse = () => SetMetadata('course.raw-response',true);
export interface SuccessBody<T> {
  data: T;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, SuccessBody<T> | T>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessBody<T> | T> {
    if (Reflect.getMetadata('course.raw-response',_context.getHandler())) return next.handle();
    return next.handle().pipe(map((data) => ({ data })));
  }
}
