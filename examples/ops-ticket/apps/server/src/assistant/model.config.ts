export interface ModelConfig { endpoint: string; apiKey: string; model: string; }

// 只读服务器环境；三个配置都缺省时由调用层选择明确标注的模拟模式。
export function readModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const base = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!base && !apiKey && !model) return null;
  if (!base || !apiKey || !model) throw new Error('LLM_CONFIG_INCOMPLETE');
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('LLM_CONFIG_INVALID'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('LLM_CONFIG_INVALID');
  }
  // BASE_URL 是 API 根路径，例如 /v1，不接受完整的 /chat/completions。
  url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  return { endpoint: url.href, apiKey, model };
}
