import { ShutdownState } from './health/shutdown-state.js';
import { drainingMiddleware } from './health/drain-and-close.js';
import { requestContextMiddleware } from './common/request-context.js';
import { httpLogMiddleware } from './common/http-log.middleware.js';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ResponseInterceptor } from './common/response.interceptor.js';

// 所有全局配置集中在这里，main.ts 和接口测试调用同一个函数，两边不会不一致
export function configureApp(app: INestApplication): void {
  app.use(drainingMiddleware(app.get(ShutdownState)));
  app.use(requestContextMiddleware);
  app.use(httpLogMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 去掉 DTO 里没声明的字段
      forbidNonWhitelisted: true, // 多传字段直接 400，而不是悄悄忽略
      transform: true, // 把参数转成 DTO 类型，例如字符串 '1' 转成数字 1
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
}
