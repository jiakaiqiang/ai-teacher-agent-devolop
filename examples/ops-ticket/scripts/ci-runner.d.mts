import type { SpawnSyncOptions } from 'node:child_process';
export interface Stage {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions['stdio'];
}
export function runStages(stages: Stage[], report?: (line: string) => void): number;
