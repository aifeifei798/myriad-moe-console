export type Lang = 'zh' | 'en';

function fmt(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    return v === undefined ? m : String(v);
  });
}

const ERR_ZH: Record<string, string> = {
  transport: '无法连接推理服务{tail}：{msg}',
  timeout: '请求超时（3s）',
  network: '网络请求失败',
  '401': 'API Key 无效或缺失（HTTP 401）。请在右上角「配置中心」检查 API Key。',
  '403': '当前令牌为只读权限，无权执行该写操作。请改用管理员 API Key。',
  '404': '端点不存在（HTTP 404）。Base URL 需要包含 /v1 前缀，例如 http://127.0.0.1:8000/v1',
  '413': '上传内容过大（HTTP 413）。',
  '413d': '上传内容过大（HTTP 413）：{d}',
  '503': '推理服务尚未就绪（HTTP 503）。',
  '503d': '推理服务尚未就绪（HTTP 503）：{d}',
  '400': '请求被服务端拒绝（HTTP 400）。',
  '400d': '请求被服务端拒绝（HTTP 400）：{d}',
};

const ERR_EN: Record<string, string> = {
  transport: 'Cannot reach inference service{tail}: {msg}',
  timeout: 'Request timed out (3s)',
  network: 'Network request failed',
  '401': 'Invalid or missing API key (HTTP 401). Check it in Settings (top right).',
  '403': 'Read-only token: not allowed to run this write. Use an admin API key.',
  '404': 'Endpoint not found (HTTP 404). Base URL must include the /v1 prefix, e.g. http://127.0.0.1:8000/v1',
  '413': 'Upload too large (HTTP 413).',
  '413d': 'Upload too large (HTTP 413): {d}',
  '503': 'Inference service not ready yet (HTTP 503).',
  '503d': 'Inference service not ready yet (HTTP 503): {d}',
  '400': 'Rejected by server (HTTP 400).',
  '400d': 'Rejected by server (HTTP 400): {d}',
};
export class MyriadApiError extends Error {
  readonly status: number | null;
  readonly detail: string;
  readonly isTransport: boolean;

  constructor(
    message: string,
    opts: { status?: number | null; detail?: string; isTransport?: boolean } = {},
  ) {
    super(message);
    this.name = 'MyriadApiError';
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? message;
    this.isTransport = opts.isTransport ?? false;
  }

  /** 传输层失败 = 服务可能压根没启动，这是唯一可以放心演示/兜底的场景。 */
  static transport(message: string): MyriadApiError {
    return new MyriadApiError(message, { isTransport: true });
  }

  /** 服务端返回了非 2xx。 */
  static http(status: number, statusText: string, detail?: string): MyriadApiError {
    // detail 保留服务端原文（可能为空），不要在这里塞 "HTTP 403" ——
    // 否则 describe() 里那些更有用的中文兜底文案就永远走不到了。
    const raw = (detail ?? '').trim();
    const fallback = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
    return new MyriadApiError(raw || fallback, { status, detail: raw, isTransport: false });
  }

  /** 展示给用户的完整说明，带上状态码与排查提示。lang 默认为中文，保持老调用兼容。 */
  describe(baseUrl?: string, lang?: Lang): string {
    const T = lang === 'en' ? ERR_EN : ERR_ZH;
    if (this.isTransport) {
      const tail = baseUrl ? (lang === 'en' ? ` (Base URL: ${baseUrl})` : `（Base URL: ${baseUrl}）`) : '';
      return fmt(T.transport, { tail, msg: this.translateTransportMsg(this.message, lang) });
    }
    const d = this.detail.trim();
    switch (this.status) {
      case 401:
        return d || T['401'];
      case 403:
        return d || T['403'];
      case 404:
        return d || T['404'];
      case 413:
        return d ? fmt(T['413d'], { d }) : T['413'];
      case 503:
        return d ? fmt(T['503d'], { d }) : T['503'];
      case 400:
        return d ? fmt(T['400d'], { d }) : T['400'];
      default:
        return d || this.message;
    }
  }

  /** 传输层 message 本身也可能是中文固定文案，做一次对照翻译。 */
  private translateTransportMsg(msg: string, lang?: Lang): string {
    if (lang !== 'en') return msg;
    if (msg.includes('请求超时')) return ERR_EN.timeout;
    if (msg.includes('网络请求失败')) return ERR_EN.network;
    if (msg.includes('上传失败（网络错误）')) return 'Upload failed (network error)';
    if (msg.includes('上传超时')) return 'Upload timed out';
    if (msg.includes('流式连接意外中断')) return 'Stream interrupted unexpectedly (no usage / [DONE] received)';
    if (msg.includes('服务端生成失败')) return 'Server generation failed';
    if (msg.includes('不支持流式响应')) return 'Streaming unsupported in this browser (no ReadableStream)';
    return msg;
  }
}

/** 从 fetch 的 TypeError / AbortError 里提取可读信息。 */
export function describeTransportError(err: unknown): MyriadApiError {
  if (err instanceof MyriadApiError) return err;
  const e = err as { name?: string; message?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return MyriadApiError.transport('请求超时（3s）');
  }
  return MyriadApiError.transport(e?.message || '网络请求失败');
}

/**
 * 尝试从错误响应体里解析出服务端给的 detail。
 * FastAPI 的错误体形如 {"detail": "..."} 或 {"detail": [{"msg": "...", ...}]}。
 */
export async function extractDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      const d = parsed?.detail ?? parsed?.error?.message;
      if (typeof d === 'string') return d;
      if (Array.isArray(d) && d.length) {
        return d.map((x: { msg?: string }) => x?.msg || '').filter(Boolean).join('; ');
      }
      return '';
    } catch {
      // 非 JSON 响应体，原样返回前 200 字符便于排查
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}