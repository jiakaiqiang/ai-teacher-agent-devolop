import { readModelConfig, type ModelConfig } from './model.config.js';

export interface ModelRoute { alias: string; model: string; }
// 一个受信任中转站，多个模型别名；地址与凭据仍只从原来的三个变量读取。
export class ModelRegistry {
  private readonly routes: ReadonlyMap<string, string>;
  constructor(private readonly base: ModelConfig | null, entries: readonly ModelRoute[] = []) {
    const rows = entries.length ? entries : [{ alias: 'default', model: base?.model ?? 'mock-model' }];
    if (rows.length > 8) throw new Error('MODEL_ROUTES_INVALID');
    const map = new Map<string, string>();
    for (const row of rows) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(row.alias) || !row.model.trim() || row.model.length > 128 || /[\r\n]/.test(row.model) || map.has(row.alias)) throw new Error('MODEL_ROUTES_INVALID');
      map.set(row.alias, row.model);
    }
    if (!map.has('default')) throw new Error('MODEL_DEFAULT_MISSING');
    this.routes = map;
  }
  aliases(): string[] { return [...this.routes.keys()]; }
  resolve(alias = 'default'): ModelConfig | null {
    const model = this.routes.get(alias);
    if (!model) throw new Error('MODEL_NOT_ALLOWED');
    return this.base ? { ...this.base, model } : null;
  }
}

export function readModelRegistry(env: NodeJS.ProcessEnv = process.env): ModelRegistry {
  const base = readModelConfig(env);
  const raw = env.LLM_MODEL_ROUTES?.trim();
  if (!raw) return new ModelRegistry(base);
  // 只允许非秘密的alias/model映射，禁止把客户端或配置里的URL当作上游。
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error('MODEL_ROUTES_INVALID'); }
  if (!base || !Array.isArray(value) || !value.length || value.some(row => !row || typeof row !== 'object'
    || Object.keys(row).sort().join(',') !== 'alias,model' || typeof row.alias !== 'string' || typeof row.model !== 'string')) throw new Error('MODEL_ROUTES_INVALID');
  return new ModelRegistry(base, value as ModelRoute[]);
}
