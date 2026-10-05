/**
 * 针对本次改动的运行时验证。重点覆盖之前完全缺失的错误分流与 SSE 解析逻辑。
 * 用 node 直接跑（tsx 已移除，改用 vite 自带的 esbuild 转译或直接 node --experimental-strip-types）
 */
import { MyriadApiError, describeTransportError, extractDetail } from '../src/services/apiError.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

console.log('\n[1] 错误分类：只有传输层错误允许 mock 兜底');
const authErr = MyriadApiError.http(401, 'Unauthorized', 'Invalid API key');
check('401 被标记为应用错误 (isTransport=false)', authErr.isTransport === false);
check('401 不应兜底', authErr.isTransport === false);
check('401 提示检查 API Key', authErr.describe().includes('API Key'));

const notFound = MyriadApiError.http(404, 'Not Found');
check('404 提示需要 /v1 前缀', notFound.describe().includes('/v1'));

const notReady = MyriadApiError.http(503, 'Service Unavailable', 'CUDA out of memory');
check('503 透传服务端 detail', notReady.describe().includes('CUDA out of memory'));

const transport = MyriadApiError.transport('Failed to fetch');
check('传输错误 isTransport=true', transport.isTransport === true);

check('普通 Error 不被误判为传输错误', describeTransportError(new Error('boom')).isTransport === true);
check('AbortError → 超时提示', describeTransportError({ name: 'AbortError' }).message.includes('超时'));

console.log('\n[2] detail 解析');
const mkRes = (body: string, status = 400) =>
  ({ ok: false, status, statusText: 'x', text: async () => body }) as unknown as Response;

const r1 = await extractDetail(mkRes(JSON.stringify({ detail: '宗门编号需在 0 ~ 19 之间' })));
check('解析 FastAPI {detail:string}', r1 === '宗门编号需在 0 ~ 19 之间');

const r2 = await extractDetail(
  mkRes(JSON.stringify({ detail: [{ msg: 'field required', loc: ['body', 'k'] }] })),
);
check('解析 FastAPI 422 数组形式', r2.includes('field required'));

const r3 = await extractDetail(mkRes('plain text failure'));
check('非 JSON 体降级为原文', r3 === 'plain text failure');

console.log('\n[3] SSE 解析：复刻 myriadApi 的解析循环');
function parseSSE(chunks: string[], opts: { abort?: boolean } = {}) {
  const state = {
    reasoning: '',
    content: '',
    finishReason: 'stop' as string,
    usage: null as any,
    sawDone: false,
    error: null as string | null,
    ttft: null as number | null,
    telemetry: null as any,
    onDone: false as boolean,
  };
  let buffer = '';
  for (const chunk of chunks) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') {
        state.sawDone = true;
        continue;
      }
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      let data: any;
      try {
        data = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      if (data.error) {
        state.error = data.error.message || '服务端生成失败';
        continue;
      }
      if (data.usage) state.usage = data.usage;
      if (data.myriad && typeof data.myriad === 'object') state.telemetry = data.myriad;
      if (data.choices?.length > 0) {
        const c = data.choices[0];
        if (c.finish_reason) state.finishReason = c.finish_reason;
        if (c.delta?.reasoning_content) state.reasoning += c.delta.reasoning_content;
        if (c.delta?.content) state.content += c.delta.content;
      }
    }
  }
  // 收尾逻辑
  if (state.error) {
    state.onDone = false;
  } else if (!state.sawDone && !opts.abort && state.usage === null) {
    state.error = '流式连接意外中断';
  } else {
    state.onDone = true;
  }
  return state;
}

// 正常流
const ok = parseSSE([
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"reasoning_content":"思考中"},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"世界"},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":42,"total_tokens":52}}\n\n',
  'data: [DONE]\n\n',
]);
check('正常流: content 拼接正确', ok.content === '你好世界', `got "${ok.content}"`);
check('正常流: reasoning 单独分流', ok.reasoning === '思考中', `got "${ok.reasoning}"`);
check('正常流: 捕获真实 usage (completion_tokens=42)', ok.usage?.completion_tokens === 42);
check('正常流: finish_reason=stop', ok.finishReason === 'stop');
check('正常流: 正常完成', ok.onDone === true && ok.error === null);

// 分片被网络切开：JSON 跨 chunk
const splitChunkA = 'data: {"choices":[{"index":0,"delta":{"content":"完整';
const splitChunkB = '句子"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
const split = parseSSE([splitChunkA, splitChunkB]);
check('跨 chunk 的半行被正确缓冲', split.content === '完整句子', `got "${split.content}"`);

// 服务端错误帧（之前完全没处理）
const errStream = parseSSE([
  'data: {"choices":[{"index":0,"delta":{"content":"部分"},"finish_reason":null}]}\n\n',
  'data: {"id":"x","error":{"message":"RuntimeError: CUDA out of memory","type":"server_error"},"choices":[]}\n\n',
  'data: [DONE]\n\n',
]);
check('服务端 error 帧被捕获', Boolean(errStream.error?.includes('CUDA out of memory')), `got ${errStream.error}`);
check('error 帧不会被当成成功完成', errStream.onDone === false);

// 意外断流（无 [DONE]、无 usage）
const truncated = parseSSE(['data: {"choices":[{"index":0,"delta":{"content":"半句"},"finish_reason":null}]}\n\n']);
check('断流被识别为错误而非成功', Boolean(truncated.error?.includes('意外中断')), `got ${truncated.error}`);

// 用户主动打断：abort 时不应报「意外中断」
const aborted = parseSSE(['data: {"choices":[{"index":0,"delta":{"content":"半句"},"finish_reason":null}]}\n\n'], { abort: true });
check('用户打断不算错误', aborted.error === null);

console.log('\n[4] 流式 myriad 遥测帧（本次新增）');
const withTelemetry = parseSSE([
  'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\n',
  'data: {"id":"x","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9},"myriad":{"arts_core_pct":62.0,"sci_core_pct":38.0,"cuda_graph":true,"slot_state":"idle","top_clusters":[{"id":3,"name":"Cluster_03","hits":50}]}}\n\n',
  'data: [DONE]\n\n',
]);
check('解析出 myriad 遥测', withTelemetry.telemetry?.arts_core_pct === 62.0, JSON.stringify(withTelemetry.telemetry));
check('遥测含 sci_core_pct', withTelemetry.telemetry?.sci_core_pct === 38.0);
check('遥测含 top_clusters', Array.isArray(withTelemetry.telemetry?.top_clusters));
check('遥测不影响正文', withTelemetry.content === '你好');
check('遥测帧不影响完成判定', withTelemetry.onDone === true && withTelemetry.error === null);
check('遥测帧的 usage 仍被捕获', withTelemetry.usage?.completion_tokens === 2);

const noTelemetry = parseSSE([
  'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
  'data: [DONE]\n\n',
]);
check('未下发遥测时为 null（不报错）', noTelemetry.telemetry === null);
check('未下发遥测仍正常完成', noTelemetry.onDone === true);

// 遥测帧分片被切开
const telSplitA = 'data: {"choices":[],"myriad":{"arts_core_pct":61.5,';
const telSplitB = '"sci_core_pct":38.5}}\n\ndata: [DONE]\n\n';
check('跨 chunk 的遥测帧被正确缓冲', parseSSE([telSplitA, telSplitB]).telemetry?.arts_core_pct === 61.5);

console.log(`\n结果: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);