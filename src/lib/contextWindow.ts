/**
 * 上下文滑动窗口。
 *
 * 服务端无状态：客户端每次都把完整历史发过去。历史无限增长会把 prompt
 * token 越堆越高，挤爆 KV 缓存并拖慢首字延迟。这里在发送前做一次裁剪：
 *
 *   1. 永远保留开头的 system 提示词（若有）
 *   2. 其余部分只保留最近 N 轮（一轮 = 一个 user 消息 + 其后连续的 assistant 消息）
 *   3. 丢弃本地提示 / 指令回显（excludeFromContext）
 *   4. 丢弃内容为空的 assistant 消息（被中断的生成），部分 chat template 会因此报错
 *
 * 单独成 .ts 模块以便单元测试（node 无法 strip JSX）。
 */

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  excludeFromContext?: boolean;
  isStreaming?: boolean;
}

export interface TrimResult {
  messages: Array<{ role: string; content: string }>;
  /** 裁剪前参与计算的消息数（已剔除本地提示与空消息）。 */
  before: number;
  /** 裁剪后实际发送的消息数。 */
  after: number;
  /** 实际发送的轮数。 */
  rounds: number;
  /** 是否发生了裁剪。 */
  trimmed: boolean;
  /** 因长度限制被丢弃的历史轮数。 */
  dropped: number;
}

export const MIN_ROUNDS = 4;
export const MAX_ROUNDS = 30;
export const DEFAULT_ROUNDS = 10;

export function clampRounds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ROUNDS;
  return Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Math.round(n)));
}

/** 剔除不可参与对话的消息：本地提示、空回复、仍在流式中的占位。 */
function eligible(messages: ContextMessage[]): ContextMessage[] {
  return messages.filter(m => {
    if (m.excludeFromContext) return false;
    if (m.isStreaming) return false;
    if (m.role !== 'assistant') return m.content.trim().length > 0;
    // assistant 消息为空通常意味着生成被中断，发给 chat template 容易报错
    return m.content.trim().length > 0;
  });
}

export function buildContext(
  messages: ContextMessage[],
  systemPrompt: string,
  maxRounds: number,
): TrimResult {
  const rounds = clampRounds(maxRounds);
  const sys = systemPrompt.trim();
  const head: Array<{ role: string; content: string }> = sys
    ? [{ role: 'system', content: sys }]
    : [];

  const pool = eligible(messages);
  const before = pool.length + head.length;

  // 显式置于开头的 system 消息始终保留
  const leadingSystem = pool.find(m => m.role === 'system');
  const rest = pool.filter(m => m !== leadingSystem);

  // 从后往前收集，保留最近 N 轮；一轮从一条 user 消息开始。
  const kept: ContextMessage[] = [];
  let budget = rounds;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    if (m.role === 'user') {
      if (budget <= 0) break;
      budget -= 1;
    }
    kept.unshift(m);
  }

  // 裁剪后可能出现「孤立的尾部 assistant」（其对应的 user 已被丢弃）
  while (kept.length > 0 && kept[0].role === 'assistant') {
    kept.shift();
  }

  const out = [
    ...head,
    ...(leadingSystem ? [{ role: 'system', content: leadingSystem.content }] : []),
    ...kept.map(m => ({ role: m.role, content: m.content })),
  ];

  const usedRounds = kept.filter(m => m.role === 'user').length;
  return {
    messages: out,
    before,
    after: out.length,
    rounds: usedRounds,
    trimmed: out.length < before,
    dropped: rest.length - kept.length,
  };
}