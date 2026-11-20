export type Vote = 'A' | 'B' | 'invalid';
export interface Pair { line: number; question: string; chosen: string; rejected: string }
export interface Ballot { line: number; reverse: boolean; vote: Vote }

export function blind(pair: Pair, reverse: boolean) {
  return { question: pair.question, A: reverse ? pair.rejected : pair.chosen, B: reverse ? pair.chosen : pair.rejected };
}

export function agreement(lines: number[], votes: Ballot[]) {
  if (!lines.length || new Set(lines).size !== lines.length || votes.length !== 2 * lines.length) throw new Error('配对记录不完整');
  let matched = 0, bothRight = 0, inconsistent = 0, invalid = 0;
  for (const line of lines) {
    const group = votes.filter(v => v.line === line);
    const normal = group.find(v => !v.reverse), swapped = group.find(v => v.reverse);
    if (group.length !== 2 || !normal || !swapped) throw new Error('配对记录不完整');
    matched += Number(normal.vote === 'A') + Number(swapped.vote === 'B');
    bothRight += Number(normal.vote === 'A' && swapped.vote === 'B');
    invalid += group.filter(v => v.vote === 'invalid').length;
    if (normal.vote !== 'invalid' && swapped.vote !== 'invalid' && normal.vote === swapped.vote) inconsistent++;
  }
  return { presentations: votes.length, matched, bothRight, inconsistent, invalid, pairs: lines.length };
}
