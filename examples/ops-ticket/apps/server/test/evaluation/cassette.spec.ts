import { playback, record } from './cassette.js';

const frames = [{ name: 'ticket_summary' as const, data: { status: 'pending', title: '仅在源系统' } },
  { name: 'ticket_log_counts' as const, data: { counts: [] } }];
describe('工具磁带', () => {
  it('录制只保留批准字段并可重复回放', () => {
    const raw = record(frames);
    expect(raw).not.toContain('仅在源系统');
    for (let round = 0; round < 2; round++) {
      const tape = playback(raw);
      expect(tape.read('ticket_summary')).toEqual({ status: 'pending' });
      expect(tape.read('ticket_log_counts')).toEqual({ counts: [] });
      tape.finish();
    }
  });

  it('工具失序或少消费一次均报错', () => {
    const tape = playback(record(frames));
    expect(() => tape.read('ticket_log_counts')).toThrow('顺序');
    tape.read('ticket_summary');
    expect(() => tape.finish()).toThrow('未消费');
  });
});
