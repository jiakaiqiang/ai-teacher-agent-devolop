import type { QueueOptions } from 'bullmq';

// BullMQ 的连接配置（D29）。队列用单独的 Redis（QUEUE_REDIS_URL）：
// 缓存用的那个 Redis 内存满了会淘汰键（allkeys-lru），队列里的任务不能被淘汰，BullMQ 要求 noeviction
export function queueRootOptions(): QueueOptions {
  const url = process.env.QUEUE_REDIS_URL;
  if (!url) {
    throw new Error('缺少环境变量 QUEUE_REDIS_URL，请检查 apps/server/.env');
  }
  return {
    // 不像 D22 那样关掉离线队列：BullMQ 一创建连接就要发命令检查 Redis 版本，关掉后连接还没建立就失败了（D29 实测）
    connection: { url },
    // 所有队列的键都以 ops: 开头，和 W4 的缓存键一样好认
    prefix: 'ops',
  };
}
