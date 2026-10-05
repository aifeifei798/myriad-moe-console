import {
  ClientConfig,
  TelemetryStats,
  CatchRadarResponse,
  ServerCapability,
  PermissionRole,
} from '../types/myriad';
import { mockState } from './mockEngine';
import { mockSession } from './mockSession';
import { MyriadApiError, describeTransportError, extractDetail } from './apiError';

/** 统一的请求头。带 apiKey 时附带 Bearer token。 */
const DEFAULT_HEADERS = (apiKey?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  return headers;
};

/** 去掉 baseUrl 末尾多余的斜杠。 */
function apiUrl(config: ClientConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * 包装一次 fetch：统一把「传输层失败」和「服务端返回错误状态」区分开。
 *
 * 这是整个客户端最关键的一处修正 —— 只有传输层失败才允许走 mock 兜底。
 * 401 / 404 / 400 / 503 必须原样抛给用户，否则配置错误会被伪装成正常运行。
 */
async function request(
  config: ClientConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = apiUrl(config, path);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw describeTransportError(err);
  }
  if (!res.ok) {
    const detail = await extractDetail(res);
    throw MyriadApiError.http(res.status, res.statusText, detail);
  }
  // 真实成功 → 退出模拟模式
  mockSession.exit();
  return res;
}

async function requestJson<T>(config: ClientConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(config, path, init);
  return (await res.json()) as T;
}

/**
 * 决定是否可以对某个错误走 mock 兜底。
 * 只有传输层错误（服务没起来）才允许 —— 这是「无 GPU 也能演示」的唯一合法场景。
 */
function canFallback(err: unknown, config: ClientConfig): boolean {
  if (!config.mockFallback) return false;
  if (!(err instanceof MyriadApiError)) return false;
  if (!err.isTransport) return false;
  mockSession.enter(err.message);
  return true;
}

// ────────────────────────────────────────────────────────────────
// 连通性 / 遥测
// ────────────────────────────────────────────────────────────────

/**
 * 连通性测试。**不使用 mock 兜底** —— 这个函数的返回值直接决定顶部徽章，
 * 一旦兜底就会变成「永远在线」，彻底失去意义。
 *
 * 用 /v1/models 而不是 /v1/myriad/stats：
 *  - /v1/models 不受「模型已加载」守卫约束，服务一启动就能响应 → 能区分
 *    「服务没起来」与「服务活着但权重还在加载」；
 *  - 未就绪时它返回 myriad.layers = null，可据此判断 ready。
 */
export async function testConnection(
  config: ClientConfig,
): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  model?: string;
  ready?: boolean;
  capability?: ServerCapability;
}> {
  const t0 = performance.now();
  try {
    const res = await request(config, '/models', {
      method: 'GET',
      headers: DEFAULT_HEADERS(config.apiKey),
      signal: AbortSignal.timeout(3000),
    });
    const latency = Math.round(performance.now() - t0);
    try {
      const json = await res.json();
      const myriad = json?.data?.[0]?.myriad;
      // layers 为 null 表示引擎尚未 ready（服务端未就绪时 info={} 的缺省值）
      const ready = Boolean(myriad && myriad.layers != null);
      return {
        ok: true,
        latencyMs: latency,
        model: json?.data?.[0]?.id,
        ready,
        capability: {
          ready,
          permission: (myriad?.permission as PermissionRole) ?? 'anonymous',
          authRequired: Boolean(myriad?.auth_required),
          readOnlyAvailable: Boolean(myriad?.read_only_available),
        },
      };
    } catch {
      return { ok: true, latencyMs: latency, ready: undefined };
    }
  } catch (err: any) {
    const latency = Math.round(performance.now() - t0);
    if (err instanceof MyriadApiError) {
      return { ok: false, latencyMs: latency, error: err.describe(config.baseUrl) };
    }
    return { ok: false, latencyMs: latency, error: err?.message || '连接失败' };
  }
}

/** 拉取全息遥测。真实失败时按配置决定是否兜底。 */
export async function fetchStats(config: ClientConfig): Promise<TelemetryStats> {
  try {
    return await requestJson<TelemetryStats>(config, '/myriad/stats', {
      method: 'GET',
      headers: DEFAULT_HEADERS(config.apiKey),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.getStats();
    throw err;
  }
}

export async function fetchCatchRadar(config: ClientConfig): Promise<CatchRadarResponse> {
  try {
    return await requestJson<CatchRadarResponse>(config, '/myriad/catch', {
      method: 'GET',
      headers: DEFAULT_HEADERS(config.apiKey),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.getCatchRadar();
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────
// 神经手术操作
// ────────────────────────────────────────────────────────────────

export async function setTopK(config: ClientConfig, k: number, layer: number | null = null): Promise<any> {
  try {
    return await requestJson(config, '/myriad/topk', {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
      body: JSON.stringify({ k, layer }),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.setTopK(k, layer);
    throw err;
  }
}

export async function cageCluster(config: ClientConfig, cid: number): Promise<any> {
  try {
    return await requestJson(config, `/myriad/clusters/${cid}/cage`, {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.cage(cid);
    throw err;
  }
}

export async function freeCluster(config: ClientConfig, cid: number, layer: number | null = null): Promise<any> {
  try {
    // layer 省略 = 整宗释放；指定 layer = 仅解封该层（单层狙击的单点撤销）
    const qs = layer === null ? '' : `?layer=${layer}`;
    return await requestJson(config, `/myriad/clusters/${cid}/free${qs}`, {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.free(cid, layer);
    throw err;
  }
}

export async function snipeCluster(config: ClientConfig, layer: number, cid: number): Promise<any> {
  try {
    return await requestJson(config, '/myriad/snipe', {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
      body: JSON.stringify({ layer, cluster: cid }),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.snipe(layer, cid);
    throw err;
  }
}

export async function toggleCudaGraph(config: ClientConfig, enabled: boolean): Promise<any> {
  try {
    return await requestJson(config, '/myriad/engine', {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
      body: JSON.stringify({ cuda_graph: enabled }),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.setEngine(enabled);
    throw err;
  }
}

export async function resetTelemetryStats(config: ClientConfig): Promise<any> {
  try {
    return await requestJson(config, '/myriad/stats/reset', {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.resetStats();
    throw err;
  }
}

/**
 * 卡带热插拔。支持两种来源：
 *  - file：浏览器本地文件，走 multipart 上传（服务端 UploadFile）
 *  - path：服务端进程工作目录下的相对/绝对路径
 *
 * onProgress 用于展示上传进度（fetch 无法上报上传进度，
 * 因此只在能拿到 XHR 的场景使用 —— 见 plugCartridgeWithProgress）。
 */
export async function plugCartridge(
  config: ClientConfig,
  file: File | null,
  path: string | null,
  slot: number = 16,
): Promise<any> {
  try {
    const formData = new FormData();
    if (file) formData.append('file', file, file.name);
    if (path) formData.append('path', path);
    formData.append('slot', String(slot));

    // multipart 不能带 Content-Type，boundary 要交给浏览器自己生成
    const headers: Record<string, string> = {};
    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    return await requestJson(config, '/myriad/cartridge/plug', {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch (err) {
    if (canFallback(err, config)) return mockState.plugCartridge(file?.name || path || 'custom_rules.pt', slot);
    throw err;
  }
}

/**
 * 带上传进度的卡带植入（仅本地文件）。
 * fetch 的 upload progress 不可观测，这里用 XHR 以便给用户反馈；
 * 上传中/完成后都会正确退出模拟模式或抛出可读错误。
 */
export function plugCartridgeWithProgress(
  config: ClientConfig,
  file: File,
  slot: number,
  onProgress: (pct: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/myriad/cartridge/plug`;
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('slot', String(slot));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (config.apiKey && config.apiKey.trim()) {
      xhr.setRequestHeader('Authorization', `Bearer ${config.apiKey.trim()}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        mockSession.exit();
        resolve(body);
        return;
      }
      const detail = body?.detail;
      const msg = typeof detail === 'string' ? detail : `HTTP ${xhr.status}`;
      const err =
        xhr.status === 403
          ? new MyriadApiError(msg, { status: 403, detail: msg })
          : MyriadApiError.http(xhr.status, xhr.statusText, msg);
      // 403（只读令牌）不是传输层失败，绝不 mock 兜底
      reject(err);
    };
    xhr.onerror = () => {
      if (config.mockFallback) {
        mockSession.enter('上传失败');
        resolve(mockState.plugCartridge(file.name, slot));
        return;
      }
      reject(MyriadApiError.transport('上传失败（网络错误）'));
    };
    xhr.ontimeout = () => reject(MyriadApiError.transport('上传超时'));
    xhr.send(formData);
  });
}

// ────────────────────────────────────────────────────────────────
// 流式对话 (SSE)
// ────────────────────────────────────────────────────────────────

export interface StreamFinalData {
  finishReason: string;
  totalTimeSec: number;
  tokensPerSec?: number;
  ttftSec?: number;
  usage?: any;
  isCommand?: boolean;
  /** 本次问答专属的全息遥测（服务端在流式末尾随 myriad 字段下发）。 */
  telemetry?: PerRequestTelemetry;
}

/** 服务端 _telemetry() 的输出形状。 */
export interface PerRequestTelemetry {
  arts_core_pct?: number;
  sci_core_pct?: number;
  cuda_graph?: boolean;
  slot_state?: string;
  top_clusters?: Array<{ id: number; name: string; hits: number; slot?: boolean; caged?: boolean }>;
}

interface StreamChatHandlers {
  onReasoningDelta: (delta: string) => void;
  onContentDelta: (delta: string) => void;
  onUsage?: (usage: any) => void;
  onDone: (finalData: StreamFinalData) => void;
  onError: (err: any) => void;
}

export async function streamChatCompletion(
  config: ClientConfig,
  messages: Array<{ role: string; content: string }>,
  handlers: StreamChatHandlers,
  abortSignal: AbortSignal,
) {
  const tStart = performance.now();
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const isSlashCommand = lastUserMsg.trim().startsWith('/');

  const payload: any = {
    model: config.model || 'myriad-moe-25k-lora',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
    temperature: config.temperature,
    top_p: config.topP,
    repetition_penalty: config.repetitionPenalty,
    split_reasoning: config.splitReasoning,
    stream_options: { include_usage: true },
  };

  if (config.maxTokens) payload.max_tokens = config.maxTokens;

  const myriadControls: any = { stats: true };
  if (config.focusClusters.length > 0) myriadControls.focus_clusters = config.focusClusters;
  if (config.topKOverride !== null && config.topKOverride !== undefined) {
    myriadControls.top_k = config.topKOverride;
  }
  payload.myriad = myriadControls;

  try {
    const res = await request(config, '/chat/completions', {
      method: 'POST',
      headers: DEFAULT_HEADERS(config.apiKey),
      body: JSON.stringify(payload),
      signal: abortSignal,
    });

    // 斜杠指令会被服务端直接短路成普通 JSON（即使 stream=true）
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      const message = json.choices?.[0]?.message || {};
      // 指令响应也可能带 reasoning_content（如 /catch 不会有，但保持一致处理）
      if (message.reasoning_content) handlers.onReasoningDelta(message.reasoning_content);
      handlers.onContentDelta(message.content || '');
      const elapsedSec = (performance.now() - tStart) / 1000;
      handlers.onDone({
        finishReason: json.choices?.[0]?.finish_reason || 'stop',
        totalTimeSec: elapsedSec,
        tokensPerSec: json.myriad?.tokens_per_sec ?? 0,
        usage: json.usage,
        isCommand: Boolean(json.myriad?.command_dispatched),
      });
      return;
    }

    if (!res.body) {
      throw new MyriadApiError('当前浏览器不支持流式响应 (ReadableStream 不可用)');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let firstDeltaAt: number | null = null;
    let finalUsage: any = null;
    let finishReason = 'stop';
    let streamError: string | null = null;
    let sawDoneMarker = false;
    let telemetry: PerRequestTelemetry | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE 以 \n 分行；可能存在 \r\n 或被网络切开的半行，统一 trim
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          sawDoneMarker = true;
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue; // 忽略无法解析的分片
        }

        // ⚠️ 服务端在生成线程异常时会下发 {"error": {...}, "choices": []}。
        //    之前完全没有处理这个分支，导致用户看到一条空的、标着「完成」的消息。
        if (data.error) {
          streamError = data.error.message || '服务端生成失败';
          continue;
        }

        if (data.usage) {
          finalUsage = data.usage;
          handlers.onUsage?.(data.usage);
        }

        // 流式末尾的本次请求专属遥测（服务端 _telemetry，此前只有非流式路径才有）
        if (data.myriad && typeof data.myriad === 'object') {
          telemetry = data.myriad as PerRequestTelemetry;
        }

        if (data.choices?.length > 0) {
          const choice = data.choices[0];
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;
          if (delta) {
            if (delta.reasoning_content) {
              if (firstDeltaAt === null) firstDeltaAt = performance.now();
              handlers.onReasoningDelta(delta.reasoning_content);
            }
            if (delta.content) {
              if (firstDeltaAt === null) firstDeltaAt = performance.now();
              handlers.onContentDelta(delta.content);
            }
          }
        }
      }
    }

    const elapsedSec = Math.max(0.01, (performance.now() - tStart) / 1000);

    // 流中途出错：如实上报，而不是伪装成一次成功的空回答
    if (streamError) {
      handlers.onError(new MyriadApiError(streamError, { status: 500, detail: streamError }));
      return;
    }
    // 没有收到 [DONE] 就断流，通常意味着连接被中断
    if (!sawDoneMarker && !abortSignal.aborted && finalUsage === null) {
      handlers.onError(
        new MyriadApiError(
          `流式连接意外中断${finalUsage === null ? '（未收到 usage 与 [DONE] 标记）' : ''}`,
          { isTransport: true },
        ),
      );
      return;
    }

    // 真实吐字速率：服务端下发的 usage 才是准确 token 数。
    // 之前用「SSE 分片数 / 耗时」估算，一个分片可能含多个 token，数值完全不可信。
    let tokensPerSec: number | undefined;
    if (finalUsage?.completion_tokens != null && elapsedSec > 0) {
      tokensPerSec = Number((finalUsage.completion_tokens / elapsedSec).toFixed(1));
    }
    const ttftSec = firstDeltaAt !== null ? Number(((firstDeltaAt - tStart) / 1000).toFixed(3)) : undefined;

    handlers.onDone({
      finishReason,
      totalTimeSec: elapsedSec,
      tokensPerSec,
      ttftSec,
      usage: finalUsage || undefined,
      telemetry,
      isCommand: isSlashCommand,
    });
  } catch (err: any) {
    if (abortSignal.aborted) {
      handlers.onDone({
        finishReason: 'cancelled',
        totalTimeSec: (performance.now() - tStart) / 1000,
      });
      return;
    }

    // 只有传输层失败才允许 mock 兜底；401/404/503 等一律如实报错
    if (err instanceof MyriadApiError && err.isTransport && config.mockFallback) {
      mockSession.enter(err.message);
      await runMockStream(messages, handlers, abortSignal, tStart);
      return;
    }

    if (err instanceof MyriadApiError) {
      handlers.onError(err);
      return;
    }
    handlers.onError(describeTransportError(err));
  }
}

// ────────────────────────────────────────────────────────────────
// Mock 引擎（仅在传输层失败时启用，且 UI 会显示显式横幅）
// ────────────────────────────────────────────────────────────────

async function runMockStream(
  messages: Array<{ role: string; content: string }>,
  handlers: StreamChatHandlers,
  signal: AbortSignal,
  tStart: number,
) {
  mockState.slotState = 'busy';
  const lastMsg = messages[messages.length - 1]?.content.trim() || '';

  if (lastMsg.startsWith('/')) {
    handlers.onContentDelta(handleMockSlashCommand(lastMsg));
    mockState.slotState = 'idle';
    handlers.onDone({ finishReason: 'stop', totalTimeSec: 0.1, isCommand: true });
    return;
  }

  const thinkingSteps = [
    '正在分析输入意图与语义拓扑结构...\n',
    '唤醒文理双核：评估文科常识基盘 (Arts) 与理科宏核 (Sci) 的先验权重分配...\n',
    '检索活跃宗门：Code_Algo、Math_Formula 以及当前未被禁闭的微专家集群...\n',
    '异构金字塔开核调度：计算各层路由激活分布与 CUDA Graph 捕获缓存命中率...\n',
    '微专家协同推演完成，组织高精度流式解答。\n',
  ];

  for (const step of thinkingSteps) {
    if (signal.aborted) {
      mockState.slotState = 'idle';
      handlers.onDone({ finishReason: 'cancelled', totalTimeSec: (performance.now() - tStart) / 1000 });
      return;
    }
    handlers.onReasoningDelta(step);
    await new Promise(r => setTimeout(r, 160));
  }

  let responseText = mockAnswerFor(lastMsg);

  const words = responseText.split(/(?=[ \n，。！？、：；])/);
  let generatedTokens = 0;
  for (const w of words) {
    if (signal.aborted) {
      mockState.slotState = 'idle';
      handlers.onDone({ finishReason: 'cancelled', totalTimeSec: (performance.now() - tStart) / 1000 });
      return;
    }
    handlers.onContentDelta(w);
    generatedTokens += 1;
    await new Promise(r => setTimeout(r, 22));
  }

  mockState.slotState = 'idle';
  mockState.recordGeneration(Math.round(lastMsg.length / 2), generatedTokens);

  const totalTime = (performance.now() - tStart) / 1000;
  const promptTokens = Math.round(lastMsg.length / 2);
  handlers.onDone({
    finishReason: 'stop',
    totalTimeSec: totalTime,
    tokensPerSec: Number((generatedTokens / totalTime).toFixed(1)),
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: generatedTokens,
      total_tokens: promptTokens + generatedTokens,
    },
  });
}

function mockAnswerFor(lastMsg: string): string {
  if (lastMsg.includes('你好') || lastMsg.includes('hello')) {
    return `您好！我是 **Myriad-MoE** 25,200 微专家混合架构大模型。

我的系统特性如下：
- **双大核架构**：文科常识基盘 (Arts Core) 与理科宏核 (Sci Core) 实时协同动态分配算力。
- **25,200 微专家**：28 层 × 20 宗门 × 45 微专家，支持弹性动态开核（Top-K 1~10）。
- **极速解码**：配合 CUDA Graph 全静态捕获，支持毫秒级低延迟推流。
- **神经透视**：支持实时宗门禁闭（\`/cage\`）、单层狙击（\`/snipe\`）及特区卡带热插拔（\`/plug\`）。

请问今天有什么探索任务需要启动协同推理？`;
  }
  if (lastMsg.includes('代码') || lastMsg.includes('code') || lastMsg.includes('算法')) {
    return `已调用 **#00 Code_Algo** 与 **#06 Logic_Proof** 宗门集群。

以下是实现快速排序与二分查找的高效 TypeScript 实现示例：

\`\`\`typescript
/**
 * 3-Way QuickSort (三向切分快速排序)
 * 专为包含大量重复键值的场景优化，时间复杂度 O(N log N)
 */
export function quickSort3Way<T>(arr: T[], low = 0, high = arr.length - 1): void {
  if (low >= high) return;

  const pivot = arr[low];
  let lt = low;
  let gt = high;
  let i = low + 1;

  while (i <= gt) {
    if (arr[i] < pivot) {
      [arr[lt], arr[i]] = [arr[i], arr[lt]];
      lt++;
      i++;
    } else if (arr[i] > pivot) {
      [arr[i], arr[gt]] = [arr[gt], arr[i]];
      gt--;
    } else {
      i++;
    }
  }

  quickSort3Way(arr, lt, lt - 1);
  quickSort3Way(arr, gt + 1, high);
}
\`\`\`

#### 数学复杂度评估
$$T(n) = 2T(n/2) + \\Theta(n) \\implies T(n) = \\mathcal{O}(n \\log n)$$

当前解码引擎保持 **CUDA Graph ⚡ ON** 状态，算力分配：**理科宏核 78.4%**，**文科基盘 21.6%**。`;
  }
  return `已接收您的神经推理请求：「${lastMsg}」。

### 架构路由遥测剖析
1. **文理分配**：当前问题激活了理科宏核推理路径与常识逻辑层。
2. **活跃宗门拓扑**：
   - \`#00 Code_Algo\`：激活率 89.2%
   - \`#06 Logic_Proof\`：激活率 76.5%
   - \`#01 Math_Formula\`：激活率 64.1%
3. **专家并行度**：当前 28 层异构金字塔并发维持在 $k \\times 45$ 微专家槽位。

您可以随时在右侧**【神经全息监控台】**或对话框中输入 \`/catch\` 雷达扫描，观察具体各层的宗门权重倾斜！`;
}

function handleMockSlashCommand(cmd: string): string {
  const [name, ...args] = cmd.trim().split(/\s+/);
  const lower = name.toLowerCase();

  switch (lower) {
    case '/help':
    case '/h':
      return `📖【Myriad-MoE API 能力速查】
神经透视 : /catch 逐层主导宗门雷达 · /stats 全息看板 · /clusters 宗门状态
弹性开核 : /show_k 各层开核数 · /set_k <层> <核数> · /set_k_all <核数>
神经禁闭 : /cage <宗门> · /free <宗门> · /snipe <层> <宗门>
热插拔   : /plug <卡带.pt> [插槽, 默认16]
引擎参数 : /graph 切换 CUDA Graph · /maxlen <n> 默认回复上限
会话     : /clear 清空上下文 · /help 本指南
REST 等价: /v1/myriad/{stats,topk,catch,clusters,engine,cartridge/plug,metrics}`;

    case '/stats': {
      const d = mockState.getStats();
      const heat = d.top_clusters.map(h => `#${h.id.toString().padStart(2, '0')}${h.name}(${h.hits})`).join(' · ');
      return `🌌 文科基盘 ${d.arts_core_pct}% / 理科宏核 ${d.sci_core_pct}%
🪐 热力: ${heat}
⚡ CUDA Graph=${d.cuda_graph} · 显存 ${d.vram.allocated_mb || 0}MB · 槽位 ${d.slot_state} · 累计 ${d.metrics.completion_tokens_total} tokens`;
    }

    case '/clusters': {
      const d = mockState.getStats();
      const rows = d.per_cluster.map(
        c =>
          `  #${c.id.toString().padStart(2, '0')} ${c.name.padEnd(16)} 命中 ${c.hits.toLocaleString().padStart(9)}` +
          (c.caged ? '  🔒禁闭' : '') +
          (c.cartridge ? `  💿${c.cartridge}` : ''),
      );
      return '🪐【20 宗门状态】\n' + rows.join('\n');
    }

    case '/show_k': {
      const d = mockState.getStats();
      const rows = d.per_layer.map(
        l => `  - Layer ${l.layer.toString().padStart(2, '0')}: ${l.top_k} 核 [${'▮'.repeat(l.top_k).padEnd(10)}] (${l.active_experts} 微专家并发)`,
      );
      return '🎛️【各层开核配置】\n' + rows.join('\n');
    }

    case '/catch': {
      const radar = mockState.getCatchRadar();
      const rows = radar.layers.map(
        l =>
          `  - Layer ${l.layer.toString().padStart(2, '0')}: #${l.dominant_cluster?.toString().padStart(2, '0')} [${l.dominant_name?.padEnd(16)}] (${l.activations} 拍)${l.suspicious ? '  🔥极度可疑' : ''}`,
      );
      return '🚨【28 层神经透视雷达】\n' + rows.join('\n');
    }

    case '/set_k_all': {
      const k = parseInt(args[0] || '2', 10);
      return `⚡ [全局调频] ${JSON.stringify(mockState.setTopK(k, null))}`;
    }

    case '/set_k': {
      if (args.length < 2) return '⚠️ 用法: /set_k <层数> <开核数>, 例如 /set_k 9 4';
      return `⚡ [调频] ${JSON.stringify(mockState.setTopK(parseInt(args[1], 10), parseInt(args[0], 10)))}`;
    }

    case '/cage': {
      if (!args[0]) return '⚠️ 用法: /cage <宗门号>';
      return `🔒 [关禁闭] ${JSON.stringify(mockState.cage(parseInt(args[0], 10)))}`;
    }

    case '/free': {
      if (!args[0]) return '⚠️ 用法: /free <宗门号>';
      return `🔓 [刑满释放] ${JSON.stringify(mockState.free(parseInt(args[0], 10)))}`;
    }

    case '/snipe': {
      if (args.length < 2) return '⚠️ 用法: /snipe <层数> <宗门号>';
      return `🎯 [狙击] ${JSON.stringify(mockState.snipe(parseInt(args[0], 10), parseInt(args[1], 10)))}`;
    }

    case '/graph': {
      return `🔧 [引擎] ${JSON.stringify(mockState.setEngine(!mockState.cudaGraph))}`;
    }

    case '/clear':
      // 服务端无状态，真正的清空由客户端负责；这里只给出演示文案
      return '🧹 记忆已重置。(API 为无状态模式, 对话上下文由客户端自行维护)';

    default:
      return `❓ 未知指令 ${lower}, 输入 /help 查看全部能力`;
  }
}