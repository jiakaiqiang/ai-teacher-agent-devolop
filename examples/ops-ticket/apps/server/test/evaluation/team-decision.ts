import { readFileSync } from 'node:fs';
import { compare, type Arm } from './paired.js';
import { selection } from './selection.js';

const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(s => JSON.parse(s));
const live = lines.filter(x => x.kind === 'live' && x.edition === 'service-ticket-eval-v2');
if (live.length !== 1) throw new Error('需要一批独立的本机配对结果');
const report = compare(live[0].rows as Arm[], live[0].rounds);
console.log(JSON.stringify({ edition: live[0].edition, rounds: live[0].rounds, result: report, conclusion: selection(report) }));
