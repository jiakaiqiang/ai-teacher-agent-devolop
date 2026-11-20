import { readFileSync } from 'node:fs';
import { reviewSample } from './feedback.js';

const [file, space, limit] = process.argv.slice(2);
if (!file || !space || !limit) throw new Error('提供已获授权的导出文件、空间与抽样数量');
console.log(JSON.stringify(reviewSample(JSON.parse(readFileSync(file, 'utf8')), space,
  process.env.EVAL_SAMPLING_KEY ?? '', Number(limit)), null, 2));
