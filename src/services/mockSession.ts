/**
 * 全局「当前是否正在展示模拟数据」状态。
 *
 * 之前的问题是 mock 兜底完全静默：API Key 填错、Base URL 写错、模型没加载完，
 * 用户看到的都是一份看起来很正常的假看板和假回答。这个模块的唯一目的就是
 * 让「正在看假数据」这件事变成一个**显式、可被 UI 订阅**的状态。
 *
 * 语义：
 *  - 任何一次真实请求成功 → active = false
 *  - 任何一次真的走了 mock 分支 → active = true
 * 注意这是「当前状态」而不是「配置」：用户可以在配置里开着 mockFallback，
 * 但只要服务端活着，徽章就应该显示「在线」。
 */
type Listener = (active: boolean, reason: string) => void;

let active = false;
let reason = '';
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(active, reason);
    } catch (err) {
      console.error('[mockSession] listener failed', err);
    }
  });
}

export const mockSession = {
  isActive(): boolean {
    return active;
  },
  reason(): string {
    return reason;
  },
  /** 标记进入模拟模式。 */
  enter(why: string): void {
    const changed = !active || reason !== why;
    active = true;
    reason = why;
    if (changed) emit();
  },
  /** 标记回到真实数据。 */
  exit(): void {
    if (!active && !reason) return;
    active = false;
    reason = '';
    emit();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    // 订阅时立即推送一次当前状态，避免首帧不一致
    fn(active, reason);
    return () => {
      listeners.delete(fn);
    };
  },
};

/**
 * 轮询熔断器：连续失败时指数退避，避免服务没起来时每 2 秒打一次注定失败的请求
 * （原本是每分钟 30 次）。成功一次即完全重置。
 */
export class CircuitBreaker {
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly baseDelayMs = 1000,
    private readonly maxDelayMs = 30_000,
    private readonly threshold = 2,
  ) {}

  /** 是否应该跳过本次轮询（处于退避窗口内）。 */
  shouldSkip(now: number = Date.now()): boolean {
    return this.failures >= this.threshold && now < this.retryAt;
  }

  /** 距离下次允许重试还有多久（毫秒），不在退避中则返回 0。 */
  cooldownMs(now: number = Date.now()): number {
    if (this.failures < this.threshold) return 0;
    return Math.max(0, this.retryAt - now);
  }

  recordSuccess(): void {
    this.failures = 0;
    this.retryAt = 0;
  }

  recordFailure(now: number = Date.now()): void {
    this.failures += 1;
    if (this.failures < this.threshold) return;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (this.failures - this.threshold));
    this.retryAt = now + delay;
  }

  /** 连续失败次数（用于 UI 展示）。 */
  get failureCount(): number {
    return this.failures;
  }
}