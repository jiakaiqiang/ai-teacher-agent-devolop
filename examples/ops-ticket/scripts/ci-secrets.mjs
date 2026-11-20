import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

// 只在临时 GitHub runner 内生成本次测试凭据，绝不读取或上传开发 .env。
if (!process.env.GITHUB_ACTIONS || !process.env.GITHUB_ENV) throw new Error('仅供 Actions 临时 runner 使用');
for (const name of ['JWT_SECRET', 'SEED_USER_PASSWORD']) {
  const value = randomBytes(32).toString('hex');
  console.log(`::add-mask::${value}`);
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
