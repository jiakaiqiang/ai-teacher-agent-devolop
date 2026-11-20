# D15：登录——把 x-user 请求头换成真正的身份

第 3 周 · 2 小时 · 前置 [D14-第二周复盘](D14-第二周复盘.md)。

## 今天要做出什么

注册时选择客户公司，申请进入 pending。运维公司预建客户管理员，管理员只能审批本公司申请。获批后用户以登录令牌调用工单接口。

## 今天的目录结构

- `apps/server/src/auth/password.ts`
- `apps/server/src/auth/password.spec.ts`
- `apps/server/src/auth/auth.types.ts`
- `apps/server/src/auth/public.decorator.ts`
- `apps/server/src/auth/jwt-auth.guard.ts`
- `apps/server/src/auth/dto/login.dto.ts`
- `apps/server/src/auth/auth.service.ts`
- `apps/server/src/auth/auth.controller.ts`
- `apps/server/src/auth/auth.module.ts`
- `apps/server/src/auth/registrations.controller.ts`
- `apps/server/src/app.module.ts`
- `apps/server/src/app.controller.ts`
- `apps/server/src/tickets/ticket-write.controller.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/20261119030000_registration/migration.sql`
- `apps/server/package.json`
- `apps/server/test/login-fixtures.ts`
- `apps/server/test/registration.e2e-spec.ts`
- `apps/web/src/api/session.ts`
- `apps/web/src/api/auth.ts`
- `apps/web/src/api/http.ts`
- `apps/web/src/api/http.spec.ts`
- `apps/web/src/views/LoginView.vue`
- `apps/web/src/router.ts`
- `apps/web/src/App.vue`
- `apps/web/src/main.ts`
- `apps/web/src/components/TicketFeedback.vue`
- `apps/web/src/views/TicketDetailView.vue`
- `apps/server/test/tickets.e2e-spec.ts`
- `apps/server/test/worklists.e2e-spec.ts`
- `apps/server/test/contract.e2e-spec.ts`
- `apps/server/test/feedback.e2e-spec.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

客户端提交哪个字段能决定所属公司？谁能开管理员账号？为什么不能让客户端在注册时指定 role？

## 一、知识点与推导

注册只接收账号、密码和客户公司，服务端设定 reporter、pending。密码由 scrypt 加盐保存；令牌只携带主体，授权动作重新读数据库。先用预建管理员走通申请审批，后续把查看范围放入统一授权层。

## 二、动手开发

给本地服务配置随机 JWT_SECRET，长度至少 32。迁移 password_hash、生成客户端、构建 shared。先写“未批准登录失败、同公司管理员批准后登录成功”，用第四节接口用例创建一次性管理员并体验整个过程。开放注册入口与登录入口，替换写接口的 x-user，前端读取登录会话。

## 三、自检与提交

跑 pnpm --filter @ops-ticket/server test:e2e，在注册接口尝试自带管理员角色，然后用未审核账号登录。记录注册成功响应、审批前后登录响应和服务器实际读取的身份。

## 四、本章完整源码

**apps/server/src/auth/password.ts**

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 密码哈希：用 Node 自带的 scrypt，不引入需要编译的原生依赖
// 存储格式：scrypt$N$r$p$盐(base64)$哈希(base64)。参数存在哈希里，以后调高强度时旧密码仍能校验
const N = 2 ** 15; // CPU 和内存成本，越大越慢、越难暴力破解
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// scrypt 需要约 128 * N * r 字节内存（这里是 32MB），Node 默认上限也是 32MB，放宽一点
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  // 每个密码一个随机盐：同样的密码两次哈希结果不同，彩虹表没用
  const salt = randomBytes(16);
  const hash = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  // 用恒定时间比较：普通的 === 在第一个不同的字节就返回，耗时会泄露“前几个字节对了”
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

**apps/server/src/auth/password.spec.ts**

```ts
import { hashPassword, verifyPassword } from './password.js';

describe('密码哈希', () => {
  it('正确的密码校验通过，错误的不通过', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
  });

  it('同一个密码两次哈希结果不同（随机盐），存储里没有明文', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(a).not.toContain('same-password');
  });

  it('格式不对的存储值直接返回 false，不抛错', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$abc')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$32768$8$1$c2FsdA==')).toBe(false);
  });
});
```

**apps/server/src/auth/auth.types.ts**

```ts
import type { Request } from 'express';

// 令牌里放的内容：sub 是用户 id（JWT 的标准字段名），username 方便日志和排查
// 不放角色和权限：它们会变，令牌在过期前改不了（D16 会从数据库读权限）
export interface TokenPayload {
  sub: string;
  username: string;
}

// 守卫校验通过后挂在请求上的当前用户
export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
```

**apps/server/src/auth/public.decorator.ts**

```ts
import { SetMetadata } from '@nestjs/common';

// 标记不需要登录的接口（登录本身、健康检查）
// 全局守卫默认要求登录，新接口忘了加守卫也是安全的；需要公开的接口要显式写出来
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

**apps/server/src/auth/jwt-auth.guard.ts**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest, TokenPayload } from './auth.types.js';
import { IS_PUBLIC } from './public.decorator.js';

const unauthenticated = (message: string) => new UnauthorizedException({ code: 'UNAUTHENTICATED', message });

// 全局守卫：除了标了 @Public() 的接口，都要带 Authorization: Bearer <令牌>
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 方法上和类上的标记都要看：@Public() 可以加在单个接口上，也可以加在整个控制器上
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw unauthenticated('请先登录');
    }
    try {
      // 校验签名和过期时间；签名不对、过期、格式错误都会抛错
      const payload = await this.jwt.verifyAsync<TokenPayload>(token);
      request.user = { id: payload.sub, username: payload.username };
      return true;
    } catch {
      throw unauthenticated('登录已失效，请重新登录');
    }
  }
}
```

**apps/server/src/auth/dto/login.dto.ts**

```ts
import { IsString, Length } from 'class-validator';

// POST /api/auth/login 的请求体
export class LoginDto {
  @IsString()
  @Length(1, 64)
  username!: string;

  // 只限制长度上限：scrypt 处理超长输入很慢，不限制的话可以用一个 1MB 的“密码”拖慢服务器
  @IsString()
  @Length(1, 128)
  password!: string;
}
```

**apps/server/src/auth/auth.service.ts**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TokenPayload } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import { hashPassword, verifyPassword } from './password.js';

export interface LoginResult {
  accessToken: string;
  user: { username: string; displayName: string; role:string };
}

// 用户不存在时也要做一次同样耗时的校验，否则“用户不存在”比“密码错误”返回得快，
// 攻击者可以靠响应时间判断哪些用户名存在
const dummyHash = hashPassword('dummy-password-for-timing');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      select: { id: true, username: true, displayName: true, role:true, registrationStatus: true, passwordHash: true },
    });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await dummyHash));
    if (!user?.passwordHash || !ok || user.registrationStatus !== "approved") {
      // 用户不存在、没有设置密码、密码错误，返回完全一样的错误
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    }
    const payload: TokenPayload = { sub: user.id, username: user.username };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { username: user.username, displayName: user.displayName, role:user.role },
    };
  }

  async me(userId: string): Promise<{ username: string; displayName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    if (!user) {
      // 令牌还没过期，但用户已经被删了
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '用户不存在，请重新登录' });
    }
    return user;
  }
}
```

**apps/server/src/auth/auth.controller.ts**

```ts
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login  { "username": "bob", "password": "..." }
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto);
  }

  // GET /api/auth/me：前端刷新页面后用令牌换回当前用户
  @Get('me')
  me(@Req() request: AuthenticatedRequest): Promise<{ username: string; displayName: string }> {
    // 全局守卫已经保证 request.user 存在
    return this.authService.me(request.user!.id);
  }
}
```

**apps/server/src/auth/auth.module.ts**

```ts
import { RegistrationsController } from './registrations.controller.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    // global：其他模块（以及接口测试）可以直接注入 JwtService
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        // 和 DATABASE_URL 一样，启动时就失败；不要给密钥写默认值，写了就会有人忘记改
        if (!secret || secret.length < 32) {
          throw new Error('缺少环境变量 JWT_SECRET，或长度不足 32 个字符，请检查 apps/server/.env');
        }
        return { secret, signOptions: { expiresIn: '2h' } };
      },
    }),
  ],
  controllers: [AuthController, RegistrationsController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
```

**apps/server/src/auth/registrations.controller.ts**

```ts
import { BadRequestException, Body, Controller, ForbiddenException, Param, Post, Req } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from './password.js';
import { Public } from './public.decorator.js';
import type { AuthenticatedRequest } from './auth.types.js';

class RegisterDto {
  @IsString() @Length(1,64) username!:string;
  @IsString() @Length(8,128) password!:string;
  @IsString() company!:string;
}
@Controller('registrations')
export class RegistrationsController {
  constructor(private readonly db:PrismaService) {}
  @Public() @Post()
  async register(@Body() dto:RegisterDto) {
    const company=await this.db.company.findUnique({where:{name:dto.company}});
    if (!company) throw new BadRequestException('客户公司不存在');
    return this.db.user.create({data:{
      username:dto.username,displayName:dto.username,passwordHash:await hashPassword(dto.password),
      companyId:company.id,role:'reporter',registrationStatus:'pending',
    },select:{id:true,registrationStatus:true}});
  }
  @Post(':id/approve')
  async approve(@Req() req:AuthenticatedRequest,@Param('id') id:string) {
    const admin=await this.db.user.findFirst({where:{id:req.user!.id,role:'customer_admin',registrationStatus:'approved'}});
    if (!admin?.companyId) throw new ForbiddenException();
    const changed=await this.db.user.updateMany({where:{id,role:'reporter',companyId:admin.companyId,registrationStatus:'pending'},
      data:{registrationStatus:'approved'}});
    if (!changed.count) throw new BadRequestException('本公司没有这项待审申请');
    return {approved:true};
  }
}
```

**apps/server/src/app.module.ts**

```ts
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [PrismaModule, TicketsModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**apps/server/src/app.controller.ts**

```ts
import { Public } from './auth/public.decorator.js';
import { Controller, Get } from '@nestjs/common';
import { AppService, type HealthStatus } from './app.service.js';

@Controller()
export class AppController {
  // 构造函数参数由 Nest 的依赖注入容器自动创建并传入
  constructor(private readonly appService: AppService) {}

  // 加上全局前缀后，完整路径是 GET /api/health
  @Public()
  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
```

**apps/server/src/tickets/ticket-write.controller.ts**

```ts
import { BadRequestException, Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TicketCommands } from './ticket-commands.js';
import { SubmitTicket } from './submit-ticket.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import type { Action } from './workflow.js';

class ReportDto {
  @IsString() title!:string;
  @IsString() description!:string;
  @IsString() category!:string;
  @IsArray() @IsString({each:true}) logs!:string[];
}
class ActDto {
  @IsIn(['request_human','unresolved','assign','handle','approve','return','resolved']) action!:Action;
  @IsInt() @Min(0) version!:number;
  @IsOptional() @IsString() targetId?:string;
  @IsOptional() @IsString() comment?:string;
}
@Controller('tickets')
export class TicketWriteController {
  constructor(private readonly cmd:TicketCommands,
    private readonly reports:SubmitTicket) {}
  @Post()
  async submit(@Req() req:AuthenticatedRequest, @Headers('idempotency-key') key:string, @Body() dto:ReportDto) {
    if (!key) throw new BadRequestException('缺少请求键');
    const row=await this.reports.submit(req.user!.id,key,dto);
    return {ticketNo:row.ticketNo,status:row.status,version:row.version};
  }
  @Post(':no/actions')
  async act(@Param('no') no:string,@Req() req:AuthenticatedRequest,@Body() dto:ActDto) {
    return this.cmd.apply(no,{source:'user',id:req.user!.id},dto.action,dto.version,dto.targetId,dto.comment);
  }
}
```

**apps/server/prisma/schema.prisma**

```text
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model Company {
  id      String   @id @default(uuid(7)) @db.Uuid
  name    String   @unique
  users   User[]
  tickets Ticket[]

  @@map("companies")
}

model Department {
  id         String     @id @default(uuid(7)) @db.Uuid
  name       String     @unique
  users      User[]
  categories Category[]
  tickets    Ticket[]

  @@map("departments")
}

model Category {
  id           String     @id @default(uuid(7)) @db.Uuid
  name         String     @unique
  departmentId String     @map("department_id") @db.Uuid
  department   Department @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  tickets      Ticket[]

  @@map("categories")
}

model User {
  id                 String        @id @default(uuid(7)) @db.Uuid
  username           String        @unique
  displayName        String        @map("display_name")
  role               String
  registrationStatus String        @default("pending") @map("registration_status")
  companyId          String?       @map("company_id") @db.Uuid
  departmentId       String?       @map("department_id") @db.Uuid
  company            Company?      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  department         Department?   @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  reported           Ticket[]      @relation("reporter")
  assigned           Ticket[]      @relation("assignee")
  events             TicketEvent[]

  passwordHash String? @map("password_hash")
  @@map("users")
}

model Ticket {
  id           String           @id @default(uuid(7)) @db.Uuid
  ticketNo     String           @unique @map("ticket_no")
  title        String
  description  String
  companyId    String           @map("company_id") @db.Uuid
  categoryId   String           @map("category_id") @db.Uuid
  departmentId String           @map("department_id") @db.Uuid
  reporterId   String           @map("reporter_id") @db.Uuid
  assigneeId   String?          @map("assignee_id") @db.Uuid
  status       String           @default("agent_processing")
  version      Int              @default(0)
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  completedAt  DateTime?        @map("completed_at") @db.Timestamptz(3)
  company      Company          @relation(fields: [companyId], references: [id], onDelete: Restrict)
  category     Category         @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  department   Department       @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  reporter     User             @relation("reporter", fields: [reporterId], references: [id], onDelete: Restrict)
  assignee     User?            @relation("assignee", fields: [assigneeId], references: [id], onDelete: Restrict)
  materials    TicketMaterial[]
  events       TicketEvent[]

  @@index([companyId, createdAt(sort: Desc), id(sort: Desc)], map: "tickets_company_time")
  @@index([departmentId, status, createdAt(sort: Desc), id(sort: Desc)], map: "tickets_department_status_time")
  requestKey String? @map("request_key")
  requestHash String? @map("request_hash")
  @@unique([reporterId,requestKey])
  @@map("tickets")
}

model TicketMaterial {
  id       String @id @default(uuid(7)) @db.Uuid
  ticketId String @map("ticket_id") @db.Uuid
  logText  String @map("log_text")
  ticket   Ticket @relation(fields: [ticketId], references: [id], onDelete: Restrict)

  @@map("ticket_materials")
}

model TicketEvent {
  id         String   @id @default(uuid(7)) @db.Uuid
  ticketId   String   @map("ticket_id") @db.Uuid
  actorId    String?  @map("actor_id") @db.Uuid
  source     String
  action     String
  fromStatus String?  @map("from_status")
  toStatus   String   @map("to_status")
  comment    String   @default("")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Restrict)
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@map("ticket_events")
}
```

**apps/server/prisma/migrations/20261119030000_registration/migration.sql**

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
```

**apps/server/package.json**

```json
{
  "name": "@ops-ticket/server",
  "version": "0.0.1",
  "description": "",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "deploy": "nest deploy",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "oxlint --type-aware src/ test/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --no-file-parallelism",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:status": "prisma migrate status",
    "db:seed": "prisma db seed"
  },
  "dependencies": {
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "dotenv": "^18.0.10",
    "pg": "^8.23.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "@ops-ticket/shared": "workspace:*",
    "@nestjs/jwt": "12.0.5"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.0",
    "@nestjs/mau": "^0.2.6",
    "@nestjs/schematics": "^12.0.0",
    "@nestjs/testing": "^12.0.1",
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "@types/supertest": "^7.0.0",
    "@vitest/coverage-v8": "^4.1.2",
    "oxlint": "^1.58.0",
    "oxlint-tsgolint": "^7.0.2001",
    "prettier": "^3.4.2",
    "prisma": "7.10.1",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "tsx": "^4.23.15",
    "typescript": "^6.0.2",
    "vite": "^8.0.0",
    "vitest": "^4.1.2"
  }
}
```

**apps/server/test/login-fixtures.ts**

```ts
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';

export async function bearer(app:INestApplication, username='lin') {
  const user=await app.get(PrismaService).user.findUniqueOrThrow({where:{username}});
  return 'Bearer '+await app.get(JwtService).signAsync({sub:user.id,username});
}
```

**apps/server/test/registration.e2e-spec.ts**

```ts
import { PrismaService } from '../src/prisma/prisma.service.js';
import { hashPassword } from '../src/auth/password.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('同公司管理员审批后新用户才能登录',async()=>{
  const db=app.get(PrismaService);
  const company=await db.company.findUniqueOrThrow({where:{name:'甲公司'}});
  const username='applicant-'+crypto.randomUUID();
  const admin=await db.user.create({data:{username:'admin-'+crypto.randomUUID(),displayName:'管理员',role:'customer_admin',companyId:company.id,
    registrationStatus:'approved',passwordHash:await hashPassword('course-demo-password')}});
  const http=request(app.getHttpServer());
  try {
    const result=await http.post('/api/registrations').send({username,password:'course-demo-password',company:'甲公司'}).expect(201);
    const credentials={username,password:'course-demo-password'};
    await http.post('/api/auth/login').send(credentials).expect(401);
    const login=await http.post('/api/auth/login').send({...credentials,username:admin.username}).expect(200);
    await http.post('/api/registrations/'+result.body.data.id+'/approve').set('Authorization','Bearer '+login.body.data.accessToken).expect(201);
    await http.post('/api/auth/login').send(credentials).expect(200);
  } finally { await db.user.deleteMany({where:{username:{in:[username,admin.username]}}}); }
});
```

**apps/web/src/api/session.ts**

```ts
import { z } from 'zod'
import { ref } from 'vue'

// 登录状态（D15，替换 D13 的 current-user.ts）
// 令牌放在 sessionStorage：关掉标签页就失效，刷新页面还在。
// 代价：页面上任何脚本都能读到它，一旦有 XSS 就会被偷走。生产环境更常见的做法是
// 由后端写 HttpOnly Cookie（脚本读不到），代价是要处理 CSRF，见讲义 1.3
const STORAGE_KEY = 'ops-ticket.session'

export const sessionUserSchema = z.object({ username: z.string(), displayName: z.string(), role: z.string().optional() })
export const sessionSchema = z.object({ accessToken: z.string(), user: sessionUserSchema })
export type Session = z.infer<typeof sessionSchema>

// sessionStorage 在单元测试（Node 环境）里不存在，隐私模式下也可能不可用，读写都包在 try 里
function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = sessionSchema.safeParse(raw ? JSON.parse(raw) : null)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const session = ref<Session | null>(readStored())

export function setSession(value: Session | null) {
  session.value = value
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 存不下就只在本次打开的页面里生效
  }
}

// 任何请求收到 401 时调用：清掉登录状态，再交给页面决定怎么跳转（main.ts 里注册）
let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}
export function handleUnauthorized() {
  setSession(null)
  onUnauthorized()
}
```

**apps/web/src/api/auth.ts**

```ts
import { postJson } from './http'
import { sessionSchema, setSession } from './session'

// 登录成功后保存令牌和用户信息（D15）
export async function login(username: string, password: string): Promise<void> {
  setSession(await postJson('/api/auth/login', { username, password }, sessionSchema))
}

export function logout() {
  // 令牌是无状态的，后端不记录会话，退出只要前端丢掉令牌；令牌本身要到过期才失效
  setSession(null)
}
```

**apps/web/src/api/http.ts**

```ts
import { apiErrorSchema } from '@ops-ticket/shared'
import { z } from 'zod'
import { handleUnauthorized, session } from './session'

// 前端统一的请求错误：code 用来判断，message 用来展示
export class ApiError extends Error {
  // 前端开启了 erasableSyntaxOnly，不能用构造函数参数属性的写法，字段要单独声明
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const envelopeSchema = z.object({ data: z.unknown() })

// 所有请求都带上登录令牌（D15）
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = session.value?.accessToken
  return { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

// 解析响应并按契约校验。后端返回的结构和 shared 里的 schema 对不上时，
// 在这里就报 CONTRACT_MISMATCH，而不是让页面拿着错误的数据渲染到一半出错
async function parseResponse<T extends z.ZodType>(response: Response, path: string, schema: T): Promise<z.infer<T>> {
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    // 未登录或令牌失效：清掉登录状态，回到登录页。登录接口本身的 401（密码错误）不算
    if (response.status === 401 && parsed.success && parsed.data.error.code === 'UNAUTHENTICATED') {
      handleUnauthorized()
    }
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
    }
    // 代理或网关返回的错误（例如后端没启动时的 502）没有统一结构
    throw new ApiError(response.status, 'HTTP_ERROR', `请求失败（HTTP ${response.status}）`)
  }

  // 先拆出 { data } 外壳，再按具体接口的 schema 校验 data
  const envelope = envelopeSchema.safeParse(body)
  const parsed = schema.safeParse(envelope.success ? envelope.data.data : undefined)
  if (!parsed.success) {
    // 开发时在控制台打印具体是哪个字段不符合契约
    console.error('接口响应不符合契约', path, parsed.error.issues)
    throw new ApiError(response.status, 'CONTRACT_MISMATCH', '接口返回的数据格式不正确')
  }
  return parsed.data
}

export async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const response = await fetch(path, { signal, headers: headers() })
  return parseResponse(response, path, schema)
}

export async function postJson<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.infer<T>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return parseResponse(response, path, schema)
}
```

**apps/web/src/api/http.spec.ts**

```ts
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getJson, postJson } from './http'
import { session, setSession, setUnauthorizedHandler } from './session'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const bob = { accessToken: 'token-of-bob', user: { username: 'bob', displayName: '李四' } }

afterEach(() => {
  vi.unstubAllGlobals()
  setSession(null)
  setUnauthorizedHandler(() => {})
})

describe('请求层的登录令牌（D15）', () => {
  it('登录后每个请求都带 Authorization；没登录时不带', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, { data: { ok: true } })))
    vi.stubGlobal('fetch', fetchMock)
    const schema = z.object({ ok: z.boolean() })

    await getJson('/api/a', schema)
    setSession(bob)
    await getJson('/api/b', schema)
    await postJson('/api/c', {}, schema)

    const auth = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
    expect(auth.map((h) => h.Authorization)).toEqual([undefined, 'Bearer token-of-bob', 'Bearer token-of-bob'])
  })

  it('令牌失效（401 UNAUTHENTICATED）时清掉登录状态并通知页面；密码错误的 401 不算', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    setSession(bob)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }))
        .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' } })),
    )
    const schema = z.unknown()

    await expect(postJson('/api/auth/login', {}, schema)).rejects.toBeInstanceOf(ApiError)
    expect(session.value).not.toBeNull()
    expect(onUnauthorized).not.toHaveBeenCalled()

    await expect(getJson('/api/tickets', schema)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(session.value).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
```

**apps/web/src/views/LoginView.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '../api/auth'
import { ApiError } from '../api/http'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

// 只接受站内路径，防止 ?redirect=https://别的网站 或 //别的网站 把用户带走（开放重定向）
function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await login(username.value.trim(), password.value)
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    error.value = e instanceof ApiError && e.code === 'INVALID_CREDENTIALS' ? '用户名或密码错误' : '登录失败，请稍后重试'
  } finally {
    submitting.value = false
    password.value = ''
  }
}
</script>

<template>
  <form class="card" @submit.prevent="submit">
    <h2>登录</h2>
    <label>用户名 <input v-model="username" autocomplete="username" required maxlength="64" /></label>
    <label>密码 <input v-model="password" type="password" autocomplete="current-password" required maxlength="128" /></label>
    <button type="submit" :disabled="submitting">{{ submitting ? '登录中…' : '登录' }}</button>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.card { display: grid; gap: 12px; max-width: 320px; padding: 16px 20px; background: #fff; border: 1px solid #d0d7de; border-radius: 8px; }
label { display: grid; gap: 4px; }
.error { color: #cf222e; margin: 0; }
</style>
```

**apps/web/src/router.ts**

```ts
import { createRouter, createWebHistory } from 'vue-router'
import { session } from './api/session'

// 页面组件按路由懒加载，打开列表页时不会下载详情页的代码
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', component: () => import('./views/TicketListView.vue') },
    { path: '/tickets/:ticketNo', component: () => import('./views/TicketDetailView.vue') },
  ],
})

// 没登录时先去登录页，登录后回到原来要去的页面（D15）
// 这只是体验：真正挡住未登录请求的是后端的全局守卫
router.beforeEach((to) => {
  if (!to.meta.public && !session.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  return true
})
```

**apps/web/src/App.vue**

```vue
<script setup lang="ts">
// 页面外壳：标题、当前登录用户和路由出口
import { useRouter } from 'vue-router'
import { logout } from './api/auth'
import { session } from './api/session'

const router = useRouter()

async function onLogout() {
  logout()
  await router.replace('/login')
}
</script>

<template>
  <main>
    <header class="top">
      <h1>智能运维工单系统</h1>
      <p v-if="session" class="user">
        {{ session.user.displayName }}
        <button type="button" @click="onLogout">退出登录</button>
      </p>
    </header>
    <RouterView />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.user { display: flex; align-items: center; gap: 8px; }
</style>
```

**apps/web/src/main.ts**

```ts
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { setUnauthorizedHandler } from './api/session'
import { router } from './router'

// 任何请求发现令牌失效时回到登录页，登录后回到当前页面（D15）
setUnauthorizedHandler(() => {
  const current = router.currentRoute.value
  if (current.path !== '/login') {
    void router.replace({ path: '/login', query: { redirect: current.fullPath } })
  }
})

createApp(App).use(router).mount('#app')
```

**apps/web/src/components/TicketFeedback.vue**

```vue
<script setup lang="ts">
import { session } from '../api/session'
import { ref } from 'vue'
import type { TicketStatus } from '@ops-ticket/shared'
const props = defineProps<{ticketNo:string; version:number; status:TicketStatus}>()
const emit = defineEmits<{reload:[]}>()
const message = ref('')
const busy = ref(false)
async function act(action:string) {
  if (busy.value) return
  busy.value = true
  try {
    const res = await fetch('/api/tickets/'+encodeURIComponent(props.ticketNo)+'/actions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.value?.accessToken},
      body:JSON.stringify({action,version:props.version}),
    })
    if (res.status===409) message.value='工单已变化，请核对最新状态后操作'
    else if (!res.ok) {message.value='提交失败，请核对操作权限';return}
    else message.value='反馈已提交'
    emit('reload')
  } catch {message.value='网络中断，请刷新核对结果'}
  finally {busy.value=false}
}
</script>
<template>
  <div v-if="status==='handoff_offered'">
    <button :disabled="busy" @click="act('request_human')">人工接入</button>
  </div>
  <div v-if="status==='awaiting_feedback'||status==='reviewed'">
    <button :disabled="busy" @click="act('resolved')">已解决</button>
    <button :disabled="busy" @click="act('unresolved')">未解决</button>
  </div>
  <p v-if="message" role="status">{{message}}</p>
</template>
```

**apps/web/src/views/TicketDetailView.vue**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import TicketFeedback from '../components/TicketFeedback.vue'
import { useRoute } from 'vue-router'
import type { TicketDetail } from '@ops-ticket/shared'
import { getTicket } from '../api/tickets'
const refresh = ref(0)
const route = useRoute()
const ticket = ref<TicketDetail>()
const error = ref('')
watch([() => String(route.params.ticketNo), refresh], async ([no], _, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  ticket.value = undefined
  error.value = ''
  try {
    const result = await getTicket(no, controller.signal)
    if (!controller.signal.aborted) ticket.value = result
  } catch {
    if (!controller.signal.aborted) error.value = '工单加载失败'
  }
}, { immediate: true })
</script>
<template>
  <RouterLink to="/">返回工单列表</RouterLink>
  <p v-if="error" role="alert">{{ error }}</p>
  <article v-if="ticket"><h2>{{ ticket.ticketNo }} · {{ ticket.title }}</h2>
    <p>{{ ticket.company.name }} · {{ ticket.category.name }} · {{ ticket.department.name }}</p>
    <p>{{ ticket.description }}</p><h3>报障材料</h3>
    <pre v-for="(m, i) in ticket.materials" :key="i">{{ m.logText }}</pre>
  
    <TicketFeedback :ticket-no="ticket.ticketNo" :status="ticket.status" :version="ticket.version" @reload="refresh++"/>
  </article>
</template>
```

**apps/server/test/tickets.e2e-spec.ts**

```ts
import { bearer } from './login-fixtures.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('返回客户、部门、日志和提交记录', async () => {
  const res = await request(app.getHttpServer()).get('/api/tickets/T-001').set('Authorization',await bearer(app)).expect(200);
  const ticket = res.body.data;
  expect(ticket.company.name).toBe('甲公司');
  expect(ticket.department.name).toBe('网络部');
  expect(ticket.materials).toHaveLength(1);
  expect(ticket.events[0].actor.displayName).toBe('lin');
  expect(ticket).not.toHaveProperty('companyId');
});
it('不存在的工单返回 404', async () => {
  await request(app.getHttpServer()).get('/api/tickets/missing').set('Authorization',await bearer(app)).expect(404);
});
it('删除被工单引用的分类返回 409', async () => {
  await request(app.getHttpServer()).delete('/api/categories/' + encodeURIComponent('网络问题')).set('Authorization',await bearer(app)).expect(409);
});
```

**apps/server/test/worklists.e2e-spec.ts**

```ts
import { bearer } from './login-fixtures.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('客户和部门是两个独立的筛选维度', async () => {
  const customer = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app)).query({ company: '甲公司' }).expect(200);
  expect(customer.body.data.items.map((r: { ticketNo: string }) => r.ticketNo)).toEqual(['T-001']);
  const department = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app)).query({ department: '网络部' }).expect(200);
  expect(department.body.data.items).toHaveLength(2);
});

it('同一时间的两张工单能逐页读出并拒绝无效游标', async () => {
  const http = request(app.getHttpServer());
  const first = (await http.get('/api/tickets?limit=1').set('Authorization',await bearer(app)).expect(200)).body.data;
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = (await http.get('/api/tickets').set('Authorization',await bearer(app)).query({ limit: 1, cursor: first.nextCursor }).expect(200)).body.data;
  expect(second.items).toHaveLength(1);
  expect(new Set([first.items[0].ticketNo, second.items[0].ticketNo]).size).toBe(2);
  expect(second.nextCursor).toBeNull();
  await http.get('/api/tickets?cursor=broken').set('Authorization',await bearer(app)).expect(400);
});
```

**apps/server/test/contract.e2e-spec.ts**

```ts
import { bearer } from './login-fixtures.js';
import { ticketPageSchema, ticketDetailSchema } from '@ops-ticket/shared';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('列表和详情符合共享契约', async () => {
  const list = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app)).expect(200);
  expect(ticketPageSchema.parse(list.body.data).items).toHaveLength(2);
  const detail = await request(app.getHttpServer()).get('/api/tickets/T-001').set('Authorization',await bearer(app)).expect(200);
  expect(ticketDetailSchema.parse(detail.body.data).company.name).toBe('甲公司');
  expect(ticketPageSchema.safeParse({items:[{status:'closed'}],nextCursor:null}).success).toBe(false);
});
```

**apps/server/test/feedback.e2e-spec.ts**

```ts
import { bearer } from './login-fixtures.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('用户申请人工一次，过期反馈收到 409',async()=>{
  const http=request(app.getHttpServer());
  const created=await http.post('/api/tickets').set('Authorization',await bearer(app)).set('idempotency-key',crypto.randomUUID())
    .send({title:'演练',description:'测试人工接入',category:'网络问题',logs:[]}).expect(201);
  const {ticketNo}=created.body.data;
  const db=app.get(PrismaService);
  try {
    await db.ticket.update({where:{ticketNo},data:{status:'handoff_offered'}});
    const path='/api/tickets/'+ticketNo+'/actions';
    await http.post(path).set('Authorization',await bearer(app,'wu')).send({action:'request_human',version:0}).expect(403);
    await http.post(path).set('Authorization',await bearer(app)).send({action:'request_human',version:0}).expect(201);
    await http.post(path).set('Authorization',await bearer(app)).send({action:'request_human',version:0}).expect(409);
  } finally {
    await db.ticketEvent.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticket.delete({where:{ticketNo}});
  }
});
```


## 五、核心面试题

1. 注册接口应接收哪些字段？
2. 注册成功为什么仍不能登录？
3. 如何让客户管理员只能审批本公司？

结合本日业务样例回答后，再核对[配套面试题](D15-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

新版 6 个文件 10 项接口测试通过，包括真实注册、登录拒绝、审批和再次登录。测试管理员由受控夹具创建。
