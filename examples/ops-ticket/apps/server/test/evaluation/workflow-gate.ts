import { readFile } from 'node:fs/promises';
import { inspectActions } from './workflow-grade.js';
const failures=inspectActions(JSON.parse(await readFile(process.argv[2]!,'utf8')));
console.log(JSON.stringify({failedCases:failures}));
process.exitCode=failures.length?1:0;
