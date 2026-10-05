/**
 * 统一的服务端错误类型。
 *
 * 核心区分是 `isTransport`：
 *  - true  → fetch 本身失败（服务没起来 / 网络不通 / 超时）。只有这类才允许 mock 兜底。
 *  - false → 服务端确实返回了响应但状态码不对（401/404/400/503/500）。这类**绝不兜底**，
 *            因为 mock 兜底会把「API Key 填错」「Base URL 写错」伪装成「一切正常」，
 *            是这个项目之前最大的问题。
 */
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
    const d = detail && detail.trim() ? detail.trim() : `HTTP ${status}`;
    return new MyriadApiError(d, { status, detail: d, isTransport: false });
  }

  /** 展示给用户的完整说明，带上状态码与排查提示。 */
  describe(baseUrl?: string): string {
    if (this.isTransport) {
      const tail = baseUrl ? `（Base URL: ${baseUrl}）` : '';
      return `无法连接推理服务${tail}：${this.message}`;
    }
    if (this.status === 401) {
      return 'API Key 无效或缺失（HTTP 401）。请在右上角「配置中心」检查 API Key。';
    }
    if (this.status === 404) {
      return '端点不存在（HTTP 404）。Base URL 需要包含 /v1 前缀，例如 http://127.0.0.1:8000/v1';
    }
    if (this.status === 503) {
      return `推理服务尚未就绪（HTTP 503）：${this.detail}`;
    }
    if (this.status === 400) {
      return `请求被服务端拒绝（HTTP 400）：${this.detail}`;
    }
    return this.detail;
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