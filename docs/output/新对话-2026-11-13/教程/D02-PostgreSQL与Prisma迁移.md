# D2：用 Docker 运行 PostgreSQL，用 Prisma 把模型落库

阶段：S1 全栈 · W1 数据建模与查询 · 周二 · 2 小时

前置：完成 D1，`docs/data-model.md` 已提交；Docker Desktop 已启动。本章使用 PostgreSQL 16 和 Prisma 7.10.1。用独立练习库承接新版 D01。

## 今天要做出什么

把 D1 设计的七张表变成真实数据库里的表：

1. 用 Docker Compose 在本机跑一个 PostgreSQL，数据保存在命名卷里，重启不丢。
2. 在后端接入 Prisma 7，按 `data-model.md` 写 `schema.prisma`。
3. 生成第一份迁移，并把 Prisma 表达不了的 CHECK 约束手工加进迁移 SQL。
4. 写一份可以重复执行的种子数据：两家客户、两位获批提单人、同一个网络部、同一问题分类、两张初始工单，每单一份日志和一条提交事件。

做完以后，`pnpm --filter @ops-ticket/server db:migrate` 能把任何一个空库建成和你一样的结构，`db:seed` 能放进同一份数据。这是后面所有集成测试的基础。

## 今天的目录结构

```text
ops-ticket/
├── .gitignore                       ★ 增加 generated/，Prisma 生成的客户端不提交
├── package.json                     ★ 增加 db:up、db:down
├── infra/
│   └── docker-compose.yml           ★ 本机开发用的 PostgreSQL
└── apps/server/
    ├── package.json                 ★ 增加 Prisma 相关依赖和 db:* 脚本
    ├── .env.example                 ★ 数据库连接串示例，提交
    ├── .env                           复制自 .env.example，不提交
    ├── prisma7.config.ts            ★ Prisma 7 的配置：schema 位置、迁移目录、种子命令、连接串
    ├── prisma/
    │   ├── schema.prisma            ★ 七个模型，对应 data-model.md
    │   ├── seed.ts                  ★ 可重复执行的种子数据
    │   └── migrations/
    │       ├── migration_lock.toml    Prisma 生成，提交
    │       └── 时间戳_init/
    │           └── migration.sql    ★ Prisma 生成，末尾手工加 CHECK 约束，提交
    └── src/generated/prisma/          prisma generate 生成，不提交
```

## 时间安排

回忆 10 分钟，理解 Compose、迁移和约束 35 分钟，动手 55 分钟，自检与提交 20 分钟。如果到 1 小时 40 分钟仍在写 schema，参照第四节补齐关系字段，优先完成空库迁移和重复播种。反向 SQL 预览可放到周日。

## 零、回忆（10 分钟）

先回答三个问题，再展开核对。两家客户共用网络部，工单为什么要有两个归属？谁选择问题分类？处理人为空的工单能否完成？

<details><summary>参考答案</summary>

公司决定客户侧可见范围，分类映射决定承办部门。分类由提单人选择。用户直接采纳 Agent 建议时可以无人工作业完成。已处理和已复核状态则必须有处理人。
</details>

## 一、知识点讲解与示例（35 分钟）

### 1.1 用 Docker Compose 运行开发数据库

**为什么不在本机直接装 PostgreSQL**：版本、配置、数据目录都绑在这台电脑上，换电脑、换同事就要重来一遍；多个项目要用不同版本时会互相冲突。用容器，每个项目在 `docker-compose.yml` 里写明版本和配置，谁拿到仓库都能得到一样的数据库。

```yaml
services:
  postgres:
    image: postgres:16-alpine          # 写死大版本，不用 latest
    environment:
      POSTGRES_USER: ops
      POSTGRES_PASSWORD: ops_local_only  # 只用于本机开发
      POSTGRES_DB: ops_ticket
    ports:
      - "127.0.0.1:55433:5432"          # 宿主机 55433 → 容器 5432，只允许本机访问
    volumes:
      - pgdata:/var/lib/postgresql/data  # 数据存在命名卷里
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ops -d ops_ticket"]
```

逐项说明：

- **端口映射写成 `127.0.0.1:55433:5432`**。冒号左边是宿主机，右边是容器。写 `127.0.0.1` 是只让本机连接，不暴露给局域网。宿主机用 55433，是因为 5432 很容易被本机别的项目占用。写这份教程的电脑上，5432 就已经被另一个项目的 PostgreSQL 容器占了。
- **数据存在命名卷 `pgdata` 里**。容器本身是可以随时删掉重建的，数据不能跟着容器走。`docker compose down` 只删容器，数据还在；`docker compose down -v` 连卷一起删，数据才真的没了。
- **健康检查**。容器“启动了”不等于数据库“能连了”，PostgreSQL 启动要几秒。`docker compose up -d --wait` 会等到健康检查通过才返回，后面的迁移命令就不会因为数据库没准备好而失败。

**推导题 1.1**　同事说：“我把容器删了重建，数据还在，是不是 Docker 有缓存？”你怎么解释？什么操作会真正丢数据？

<details>
<summary>展开参考答案</summary>

不是缓存。数据写在命名卷 `ops-ticket_pgdata` 里，卷的生命周期独立于容器，删容器不影响卷，新容器挂上同一个卷就看到原来的数据。真正丢数据的操作是删卷：`docker compose down -v`、`docker volume rm ops-ticket_pgdata`。反过来，如果 compose 里没写 volumes，数据存在容器自己的文件层里，删容器就丢了。

</details>

### 1.2 Prisma 7 的结构与工作流

Prisma 由三部分组成：

| 部分 | 文件 | 作用 |
|---|---|---|
| 配置 | `prisma7.config.ts` | schema 在哪、迁移放哪、种子命令、数据库连接串 |
| 模型 | `prisma/schema.prisma` | 用 Prisma 的语法描述表结构，是唯一的真实来源 |
| 客户端 | `src/generated/prisma/` | 根据 schema 生成的 TypeScript 代码，业务代码用它查询 |

**改表结构的标准流程**：

```text
改 schema.prisma
  → prisma migrate dev --name 描述     生成 migrations/时间戳_描述/migration.sql 并应用到开发库
  → prisma generate                    重新生成客户端，TypeScript 类型跟着更新
  → prisma db seed（需要时）            放入种子数据
  → 提交 schema.prisma 和新的迁移文件
```

**Prisma 7 和网上多数教程不一样的地方**，以下都是 7.10.1 实测的结果：

1. **配置文件叫 `prisma7.config.ts`**。`prisma init` 生成的就是这个名字。网上和旧文档里常见的 `prisma.config.ts` 也能识别，但新名字优先。
2. **不再自动读取 `.env`**。配置文件第一行必须 `import 'dotenv/config'`，否则读不到 `DATABASE_URL`。
3. **客户端必须指定生成位置**。`generator` 用 `prisma-client`，`output` 必填，不再生成到 `node_modules` 里。
4. **连接数据库要用驱动适配器**。PostgreSQL 用 `@prisma/adapter-pg`，加上 `pg` 驱动：`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`。
5. **`migrate dev` 不再顺带执行 `generate` 和 `seed`**，要分别运行。
6. **`prisma init` 默认会往项目里装 AI 工具的 skills**（`.claude/`、`.agents/`、`.windsurf/` 三个目录）。我们加 `--no-skills` 不装。

另外，npm 上 `prisma` 包的 `latest` 标签目前指向 `8.0.0-rc.33`，是预发布版。直接 `pnpm add prisma` 会装到它，所以安装时要写明版本 `7.10.1`。

**推导题 1.2**　为什么生成的客户端（`src/generated/prisma/`）不提交，而迁移文件（`prisma/migrations/`）必须提交？

<details>
<summary>展开参考答案</summary>

客户端可以随时从 `schema.prisma` 重新生成，内容完全由 schema 决定，提交它只会让每次改 schema 都产生几千行无意义的 diff。迁移文件不一样：它记录了数据库结构是怎样一步步变成今天这样的，生产库就是按这些文件逐个执行出来的。迁移文件一旦丢了或者和别人的不一致，就无法保证各个环境的表结构相同。

</details>

### 1.3 把关系与行约束写进迁移

先看 T-001 的结构。`companyId` 与 `departmentId` 各关联一行；同一个 `User` 模型分别出现在提单人和处理人位置，因此要为两条关系分别命名。`assigneeId` 可空，`ticketNo` 唯一。材料和历史事件各自带 `ticketId`。Prisma 关系描述哪些记录能连接，数据库 CHECK 负责检查当前这一行的值。

推导：把没有处理人的单直接写成 `handled` 会怎样？生成的 TS 类型允许写入字符串，数据库应以 `tickets_assignee_required` 拒绝。反过来，客户能否复核工单要知道请求者身份，这在第 3 周的服务层验证。

### 1.4 迁移的规矩，以及回滚怎么做

**Prisma 怎样记住执行过哪些迁移**：数据库里有一张 `_prisma_migrations` 表，每执行一份迁移就记一行，包括迁移名和文件内容的校验和（checksum）。下次运行时，Prisma 对比迁移目录和这张表，只执行还没执行过的。

由此有两条规矩：

1. **已经应用的迁移文件不能再改**。原版迁移实验记录把已应用的 `migration.sql` 改了一个约束名，再运行 `migrate dev`：

   ```text
   The migration `20261114151843_init` was modified after it was applied.
   We need to reset the "public" schema at "localhost:55433"
   You may use prisma migrate reset to drop the development database.
   All data will be lost.
   ```

   开发库重置一下还能接受；生产库上这意味着各环境的表结构对不上。要改，就写一份新的迁移。
2. **不要手工改数据库结构**。原版迁移实验记录用 SQL 直接删掉一列，再运行 `migrate dev`，Prisma 报 `Drift detected: Your database schema is not in sync with your migration history`，并列出差异，同样要求重置。

**回滚怎么做**。Prisma 不像有些框架那样给每份迁移配一个自动的 down 脚本。实际做法有两种：

| 做法 | 怎么做 | 什么时候用 |
|---|---|---|
| 前滚修复（推荐） | 把 schema 改回去，再生成一份新迁移。例如加错了 `category` 列，就生成一份 `drop_ticket_category` 迁移删掉它 | 绝大多数情况。历史完整，每个环境都按同样的顺序执行 |
| 手写反向 SQL | 用 `migrate diff` 生成反向 SQL，用 `prisma db execute` 执行 | 生产上出了紧急问题，需要先恢复，再补迁移记录 |

生成 SQL 的命令（只读，不改数据库）：

```powershell
# 正向：当前数据库 → 新 schema，预览 migrate dev 会生成什么
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# 反向：新 schema → 当前数据库，得到撤销这次改动的 SQL
pnpm exec prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script
```

旧版独立迁移实验给 Ticket 加可选演示字段后，正向输出 `ALTER TABLE "tickets" ADD COLUMN "demo_note" VARCHAR(32);`，反向输出 `ALTER TABLE "public"."tickets" DROP COLUMN "demo_note";`。

还有一个容易误用的命令：`prisma migrate resolve --rolled-back` 只能用来标记**执行失败**的迁移。对已经成功的迁移使用，原版迁移实验记录报 `P3012: Migration ... cannot be rolled back because it is not in a failed state`。

最后，开发环境用 `migrate dev`，生产和 CI 用 `migrate deploy`。`migrate deploy` 只执行还没执行的迁移，不生成新迁移，也不会提出重置数据库。

**推导题 1.4**　你和同事各自在分支上加了一份迁移，合并后迁移目录里多了两份，时间戳一前一后。会出什么问题？

<details>
<summary>展开参考答案</summary>

假设你的迁移时间戳更早，但同事的分支先合并、先在共享的测试库上执行了。合并后，测试库的 `_prisma_migrations` 里没有你那份，`migrate status` 会把它列为“还没执行”，`migrate deploy` 会照样把它补执行上去，即使它的时间戳比已执行的那份更早。我原版迁移实验记录过这个顺序：先执行时间戳较晚的 B，再加入时间戳较早的 A，`migrate deploy` 输出 `Applying migration 20261114160000_earlier_a`。也就是说，各个环境实际执行的顺序可能不同。两份迁移改的是不同的表，通常没事；改的是同一张表，例如一份依赖另一份建的列，在某个环境上就会执行失败，或者 schema.prisma 合并后和迁移结果对不上。处理办法：合并后在本地跑一次 `migrate dev`，确认没有漂移；冲突时删掉自己那份还没进入共享环境的迁移，在合并后的 schema 上重新生成。团队里通常约定：迁移一旦进入共享环境就不再删改。

</details>

### 1.5 让种子数据可以重复执行

自然键标识这批样例，例如公司名、用户名和业务单号。通过 upsert 取得已有行的真实主键；同一事务内在工单首次创建时嵌套写材料和提交事件。若把“新增事件”放在 upsert 后每次都执行，工单仍是两张，历史却会越积越多。这是本课需要验证的失败情况。

## 二、动手开发（55 分钟）

代码自己写，可以查官方文档，不让 AI 生成。写代码的步骤卡住时按顺序展开三级提示，三级都看过仍然写不出来，再看第四节源码。提交时告诉我每一步看到了第几级提示。

### 步骤 1：启动数据库（8 分钟）

1. 新建 `infra/docker-compose.yml`，内容按 1.1 的示例补全：服务名 `postgres`，顶层写 `name: ops-ticket-course-v2`，最后声明命名卷 `pgdata`。
2. 根目录 `package.json` 加两个脚本：`"db:up": "docker compose -f infra/docker-compose.yml up -d --wait"`，`"db:down": "docker compose -f infra/docker-compose.yml down"`。
3. 启动并确认：

```powershell
Set-Location D:\demo\ops-ticket
pnpm db:up
docker compose -f infra/docker-compose.yml ps    # STATUS 一列应显示 healthy
```

完成标准：容器状态是 `healthy`，端口显示 `127.0.0.1:55433->5432/tcp`。

<details>
<summary>常见问题</summary>

- `port is already allocated`：55433 也被占用了。用 `Get-NetTCPConnection -State Listen -LocalPort 55433` 看是谁占的；换一个空闲端口时，后面 `.env` 里的端口要一起改。
- `Cannot connect to the Docker daemon` 或 `error during connect`：Docker Desktop 没启动。
- 一直不 healthy：`docker compose -f infra/docker-compose.yml logs postgres` 看日志，常见原因是卷里有旧版本 PostgreSQL 留下的数据。

</details>

### 步骤 2：安装并初始化 Prisma（10 分钟）

```powershell
Set-Location D:\demo\ops-ticket
# 版本写死：prisma 的 latest 标签现在指向 8.0 的预发布版
pnpm --filter @ops-ticket/server add @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 pg dotenv
pnpm --filter @ops-ticket/server add -D prisma@7.10.1 @types/pg tsx
Set-Location apps\server
pnpm exec prisma init --datasource-provider postgresql --no-skills
```

`prisma init` 会生成 `prisma7.config.ts`、`prisma/schema.prisma`、`.env`、`.gitignore` 四个文件。接着：

- 删掉 `apps/server/.gitignore`，改为在根目录 `.gitignore` 里加一行 `generated/`。根目录已经忽略了 `.env`，规则放一处，不分散。
- 新建 `apps/server/.env.example`，写本机的连接串：`postgresql://ops:ops_local_only@localhost:55433/ops_ticket?schema=public`。再把它复制成 `.env`。
- 改 `prisma7.config.ts`：连接串改用 `env('DATABASE_URL')`；在 `migrations` 里加 `seed: 'tsx prisma/seed.ts'`。
- 改 `schema.prisma` 的 `generator`：`output` 改成 `"../src/generated/prisma"`，让生成的客户端位于 `src` 下，`nest build` 会一起编译。

完成标准：`pnpm exec prisma validate` 输出 `The schema at prisma\schema.prisma is valid`；`git status` 里看不到 `.env`。

<details>
<summary>常见问题</summary>

- `Cannot find module ...pathe\dist\index.cjs`：本机 pnpm 存储里有包的文件不完整。在仓库根目录执行 `pnpm install --force` 重新下载。写这份教程时就遇到过，`--force` 后恢复正常。
- 安装时提示 `Ignored build scripts: @prisma/engines, prisma`：pnpm 10 默认不执行依赖的安装脚本。实测不影响 validate、migrate、generate、seed，可以不管。
- 忘了加 `--no-skills`，多出 `.claude/`、`.agents/`、`.windsurf/` 和 `skills-lock.json`：这些是给 AI 编程工具读的 Prisma 文档，和项目运行无关。确认是刚生成的再删掉。
- `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`：没有 `.env`，或者配置文件第一行漏了 `import 'dotenv/config'`。注意连 `prisma generate` 都需要这个变量。

</details>

### 步骤 3–5：先写验收，再实现模型、迁移和种子（35 分钟）

在专用练习库运行下面两条查询。空库应报告表不存在，旧版模型缺少客户归属列。记录失败原因，然后根据 D01 手写七个模型。

```sql
SELECT c.name, d.name, t.ticket_no, t.status FROM tickets t
JOIN companies c ON c.id=t.company_id JOIN departments d ON d.id=t.department_id
ORDER BY t.ticket_no;
SELECT (SELECT count(*) FROM tickets), (SELECT count(*) FROM ticket_materials),
       (SELECT count(*) FROM ticket_events);
```

<details><summary>提示 1 · 先搭关系</summary>

从 Company、Department、Category、User 开始。给 Ticket 的两条 User 关联命名 reporter、assignee。检查 Ticket 的必填字段能否只靠提单时已有的信息填满。
</details>

<details><summary>提示 2 · 先生成迁移再执行</summary>

在 apps/server 运行 `pnpm exec prisma migrate dev --name init --create-only`。在新 migration.sql 末尾加第四节的 CHECK，再 `pnpm exec prisma migrate dev` 和 `pnpm exec prisma generate`。已有旧版数据的同学用新版独立开发库与迁移目录起步，在原库上改写已执行的初始迁移会造成历史冲突。
</details>

<details><summary>提示 3 · 构造样例</summary>

先 upsert 网络部和“网络问题”，再对甲、乙各 upsert 公司与提单人。创建工单时从这两种关系取编号，使用嵌套 create 写入日志和事件。分别输入 T-001、T-002。连续运行两次 `pnpm exec prisma db seed` 后，两条查询应仍返回两家公司共用网络部和 2、2、2。
</details>

### 步骤 6：准备提交（2 分钟）

把第四节的 db 脚本加入 package.json，提交 schema、迁移及种子，生成客户端由 db:generate 重建。

## 三、自检与提交（20 分钟）

1. 运行 `pnpm --filter @ops-ticket/server db:status` 检查没有待执行迁移。对单独空库运行 `prisma migrate deploy`，证明仓库里的迁移足以重建结构。
2. 在独立练习库重复播种，再执行步骤 3–5 的两条 SELECT。检查甲、乙各一单、同在网络部、均处于 agent_processing，三种记录的数量均为 2。
3. 反证：`UPDATE tickets SET status='handled' WHERE ticket_no='T-001';` 应被 `tickets_assignee_required` 拒绝。解释一个字符串为何通过 TypeScript 检查，却不能存进数据库。
4. 选做：给 Ticket 临时增加 `demoNote String? @map("demo_note")`，使用 1.4 的两条 migrate diff 只预览正反向 SQL，检查输出再撤回这次临时字段改动。说明前滚补偿与修改历史迁移的区别。
5. 提交时给出迁移名、两次播种后的查询结果、约束拒绝记录以及实际用时。课堂批改按 schema、迁移文件和输出逐项核对。

## 四、本章完整源码

路径都相对于仓库根目录 `ops-ticket/`。先自己写完再对照。依赖的版本号以你生成时为准，脚手架更新后可能比这里新。

只列出今天新增或修改的文件，其余和 D1 相同。迁移目录名里的时间戳是生成时的时间，你的会不一样。`.env` 和 `.env.example` 内容相同，不提交，不列出。`src/generated/prisma/` 是生成的，不列出。

### 4.1 根目录

**.gitignore**

```text
# 依赖与构建产物
node_modules/
dist/
coverage/
# Prisma 生成的客户端，每次 prisma generate 重新生成
generated/

# 本机环境变量，可能包含密钥，绝不提交；只提交 .env.example
.env
.env.*
!.env.example

# 日志与系统文件
*.log
.DS_Store
```

**package.json**

```json
{
  "name": "ops-ticket",
  "private": true,
  "packageManager": "pnpm@10.28.0",
  "engines": {
    "node": ">=20.19"
  },
  "scripts": {
    "dev": "pnpm --parallel --filter \"./apps/*\" dev",
    "build": "pnpm --recursive --filter \"./apps/*\" build",
    "test": "pnpm --filter @ops-ticket/server test",
    "db:up": "docker compose -f infra/docker-compose.yml up -d --wait",
    "db:down": "docker compose -f infra/docker-compose.yml down"
  }
}
```

**infra/docker-compose.yml**

```text
# 本机开发用的依赖服务。今天只有 PostgreSQL，W4 加 Redis，W11 加 Milvus
name: ops-ticket-course-v2

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ops
      # 只用于本机开发的密码，真实环境的密码不能写进仓库
      POSTGRES_PASSWORD: ops_local_only
      POSTGRES_DB: ops_ticket
    ports:
      # 宿主机用 55433：5432 常被本机其他项目的 PostgreSQL 占用
      - "127.0.0.1:55433:5432"
    volumes:
      # 数据存在命名卷里，容器删除后数据仍在；docker compose down -v 才会删除
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ops -d ops_ticket"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  pgdata:
```

### 4.2 后端配置

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
    "rxjs": "^7.8.1"
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

**apps/server/.env.example**

```text
# 复制为 .env 后使用；.env 不提交到 Git
# 端口 55433 对应 infra/docker-compose.yml 里映射的端口
DATABASE_URL="postgresql://ops:ops_local_only@localhost:55433/ops_ticket?schema=public"
```

**apps/server/prisma7.config.ts**

```ts
// Prisma 7 不再自动读取 .env，必须在第一行显式加载
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // prisma db seed 执行的命令
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // env() 在变量缺失时直接报错，比 process.env 拿到 undefined 更早暴露问题
    url: env('DATABASE_URL'),
  },
});
```

### 4.3 模型、迁移和种子

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

**apps/server/prisma/migrations/migration_lock.toml**

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

**apps/server/prisma/migrations/20261114151843_init/migration.sql**

```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "registration_status" TEXT NOT NULL DEFAULT 'pending',
    "company_id" UUID,
    "department_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "ticket_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "assignee_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'agent_processing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_materials" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "log_text" TEXT NOT NULL,

    CONSTRAINT "ticket_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "actor_id" UUID,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_no_key" ON "tickets"("ticket_no");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_materials" ADD CONSTRAINT "ticket_materials_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 角色归属、人工处理人和用户确认时间由数据库兜底。
ALTER TABLE users ADD CONSTRAINT users_scope CHECK (
  (role IN ('reporter','customer_admin') AND company_id IS NOT NULL AND department_id IS NULL)
  OR (role IN ('department_lead','operator') AND company_id IS NULL AND department_id IS NOT NULL)
);
ALTER TABLE users ADD CONSTRAINT users_registration CHECK (registration_status IN ('pending','approved','rejected'));
ALTER TABLE tickets ADD CONSTRAINT tickets_text CHECK (btrim(description) <> '' AND btrim(title) <> '');
ALTER TABLE tickets ADD CONSTRAINT tickets_status CHECK (status IN (
  'agent_processing','awaiting_feedback','handoff_offered','pending_assignment',
  'human_processing','handled','reviewed','completed'
));
ALTER TABLE tickets ADD CONSTRAINT tickets_assignee_required CHECK (
  status NOT IN ('human_processing','handled','reviewed') OR assignee_id IS NOT NULL
);
ALTER TABLE tickets ADD CONSTRAINT tickets_completion_time CHECK ((status = 'completed') = (completed_at IS NOT NULL));
ALTER TABLE ticket_events ADD CONSTRAINT events_actor CHECK (
  (source = 'user' AND actor_id IS NOT NULL) OR (source = 'agent' AND actor_id IS NULL)
);
```

**apps/server/prisma/seed.ts**

```ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const createdAt = new Date('2026-11-19T01:00:00Z');

async function seed() {
  await prisma.$transaction(async tx => {
    const department = await tx.department.upsert({
      where: { name: '网络部' }, create: { name: '网络部' }, update: {},
    });
    const category = await tx.category.upsert({
      where: { name: '网络问题' }, update: {},
      create: { name: '网络问题', departmentId: department.id },
    });
    for (const [name, username, ticketNo] of [
      ['甲公司', 'lin', 'T-001'], ['乙公司', 'wu', 'T-002'],
    ]) {
      const company = await tx.company.upsert({ where: { name }, create: { name }, update: {} });
      const reporter = await tx.user.upsert({
        where: { username }, update: {}, create: {
          username, displayName: username, role: 'reporter', registrationStatus: 'approved', companyId: company.id,
        },
      });
      // 嵌套写入使新建工单、初始事件和日志同进同退。再次播种保留已有记录。
      await tx.ticket.upsert({
        where: { ticketNo }, update: {}, create: {
          ticketNo, title: '网络连接超时', description: '提交请求后连续超时',
          companyId: company.id, departmentId: category.departmentId, categoryId: category.id,
          reporterId: reporter.id, createdAt,
          materials: { create: { logText: 'client timeout after 5s' } },
          events: { create: { action: 'submitted', source: 'user', actorId: reporter.id,
            toStatus: 'agent_processing', createdAt } },
        },
      });
    }
  });
}
seed().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
```

## 五、核心面试题（选做，5 分钟）

完整的原题、原文答案和其余题目在 [D2 面试题](D02-面试题.md)，周日练。

**1. 生产环境的数据库能用 Docker 部署吗？**
来源：掘金，2025-06-25。
要点：开发和测试用 Docker 没有争议，今天就是这么做的。生产上的顾虑在于数据库是有状态的：数据必须挂载到卷里活得比容器久，扩容要处理主从同步，磁盘 IO 和资源隔离要专门调。很多团队的生产库用云厂商的托管数据库或者独立的虚拟机，应用本身才容器化。

**2. 千万级的大表怎样加字段才不影响线上？**
来源：掘金，2025-06-09、2025-08-06。原文讲的是 MySQL，要换成本项目用的 PostgreSQL 来答。
要点：PostgreSQL 11 起，加可空字段、加带常量默认值的字段都只改元数据，实测百万行 1 到 4 毫秒；默认值要逐行计算时会重写整张表，实测 1.5 秒，表越大越久，期间锁表。建索引用 `CREATE INDEX CONCURRENTLY`，加约束用 `NOT VALID` 再 `VALIDATE`。改字段类型、重命名这类变更，用“先扩展、再迁移数据、最后收缩”的多次发布完成。

**3. Prisma 的迁移怎么回滚？**
来源：掘金《Prisma Migrate 操作指南》，2025-11-01。
要点：没有自动的 down 脚本。常规做法是前滚修复：改回 schema，生成一份新迁移。紧急情况用 `migrate diff` 生成反向 SQL。已经应用的迁移文件不能改，校验和会对不上。开发用 `migrate dev`，生产用 `migrate deploy`。

## 六、个人建议

- **今天最值钱的是 1.4**。会写 schema 不稀奇，能讲清迁移的规矩、回滚的做法和团队协作时的冲突，才是“做过真实后端”的信号。3.3 的反证实验一定要做。
- **对照着前端的经验理解迁移**。你维护过组件库和私有 npm 包：发布出去的版本不能改，只能发新版本。迁移文件是同一个道理：已经执行过的迁移就是已发布的版本。
- **注意 Prisma 7 和网上旧教程的差异**。遇到报错，先看是不是按旧版写法写的，例如配置文件名、`.env` 的加载、客户端的导入路径。这类问题以后换任何工具都会遇到：先确认文档和你装的版本是否一致。
- **种子数据要满足约束**。如果种子脚本报了 CHECK 约束错误，先别改约束，想想是数据错了还是约束设计错了。这正是约束在帮你。
- **全部手写**。`schema.prisma` 这种照着表格翻译的工作很容易想让 AI 代劳，但翻译的过程就是在复习 D1 的设计。

## 七、拓展知识点

| 知识点 | 为什么值得学 | 学到什么程度 | 什么时候用到 |
|---|---|---|---|
| 影子数据库（shadow database） | `migrate dev` 用它检测漂移；对比迁移目录的 `migrate diff` 也需要它（实测不配置 `shadowDatabaseUrl` 会报错） | 知道它是什么、为什么生产环境不需要 | 遇到相关报错时 |
| Prisma Migrate 的基线迁移（baselining） | 已有生产库要接入 Prisma 时，不能让 Prisma 重新建表，要把现有结构标记为“已执行” | 知道 `migrate resolve --applied` 的用途 | 接手老项目时 |
| 扩展-收缩（expand and contract）迁移 | 不停机地改字段名、改类型、拆表的标准做法 | 能说出三个阶段分别做什么，以及每个阶段的代码要兼容新旧两种结构 | W6 讲部署时 |
| PostgreSQL 的锁级别 | `ALTER TABLE` 大多要 ACCESS EXCLUSIVE 锁，会挡住所有读写；`CONCURRENTLY` 和 `NOT VALID` 就是为了避开它 | 能说出哪些 DDL 会锁表，以及 `lock_timeout` 的作用 | W2 讲并发时 |
| Docker 卷的备份与恢复 | 本机数据也可能误删，`pg_dump` 和 `pg_restore` 是最基本的备份手段 | 会用 `pg_dump` 导出一份种子之外的数据 | W6 |

## 本文验证范围

新版在隔离的 PostgreSQL 16 上用 Prisma 7.10.1 验证了空库迁移、生成客户端、两次播种、按归属查询和缺失处理人的约束拒绝。旧表查询 company_id 报列不存在，应用新版迁移后，同一查询能读取两个独立归属。本次没有重测生产大表变更耗时或学员实际用时。
