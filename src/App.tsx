import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage, ClientConfig, TelemetryStats, ServerCapability } from './types/myriad';
import { fetchStats, streamChatCompletion, testConnection } from './services/myriadApi';
import { mockSession, CircuitBreaker } from './services/mockSession';
import { MyriadApiError } from './services/apiError';
import { buildContext, DEFAULT_ROUNDS, clampRounds } from './lib/contextWindow';
import { ChatArea, type ConnStatus } from './components/ChatArea';
import { NeuralDashboard } from './components/NeuralDashboard';
import { ConfigModal } from './components/ConfigModal';
import { useLang } from './lib/i18n';

const DEFAULT_CONFIG: ClientConfig = {
  baseUrl: 'http://127.0.0.1:8000/v1',
  apiKey: '',
  model: 'myriad-moe-25k-lora',
  systemPrompt: '',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 1024,
  repetitionPenalty: 1.15,
  splitReasoning: true,
  // 默认关闭。之前默认开启会让 401/404/503 全部被伪装成「正常运行」。
  mockFallback: false,
  pollIntervalMs: 5000,
  contextRounds: DEFAULT_ROUNDS,
  focusClusters: [],
  topKOverride: null,
};

/** localStorage 里恢复历史时，把中断的流式状态归位，避免永久转圈。 */
function sanitizeHistory(raw: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m: any) => m && typeof m.id === 'string' && typeof m.content === 'string')
      .map((m: any) => ({
        ...m,
        // 刷新页面时正在流式生成的消息会永远卡在「正在调度...」
        isStreaming: false,
      }));
  } catch {
    return [];
  }
}

export default function App() {
  const { t, lang } = useLang();
  const [config, setConfig] = useState<ClientConfig>(() => {
    try {
      const saved = localStorage.getItem('myriad_client_config');
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_CONFIG;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('myriad_chat_history');
      if (saved) return sanitizeHistory(saved);
    } catch {}
    return [];
  });

  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [engineReady, setEngineReady] = useState<boolean>(false);
  const [capability, setCapability] = useState<ServerCapability | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(mockSession.isActive());
  const [mockReason, setMockReason] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  // 轮询熔断器：服务没起来时避免每 2 秒打一次注定失败的请求
  const breakerRef = useRef(new CircuitBreaker());
  // 最近一次请求的上下文裁剪情况，用于在输入区如实展示
  const [lastContext, setLastContext] = useState<{
    rounds: number;
    kept: number;
    dropped: number;
    total: number;
  } | null>(null);
  const lastContextRef = useRef<typeof lastContext>(null);

  // 订阅 mock 状态，任何一次真实请求成功 / 进入模拟都会推过来
  useEffect(() => {
    return mockSession.subscribe((active, reason) => {
      setIsMockMode(active);
      setMockReason(reason);
    });
  }, []);

  const handleSaveConfig = (newConfig: ClientConfig) => {
    setConfig(newConfig);
    breakerRef.current.recordSuccess();
    try {
      localStorage.setItem('myriad_client_config', JSON.stringify(newConfig));
    } catch {}
  };

  useEffect(() => {
    try {
      localStorage.setItem('myriad_chat_history', JSON.stringify(messages));
    } catch {}
  }, [messages]);

  const refreshStats = useCallback(async () => {
    // 引擎未就绪时不要轮询 stats：服务端会一律返回 503，
    // 打了也拿不到数据，只会刷日志并把熔断器推向退避。
    // 就绪与否由 /v1/models 判定；就绪后本函数会因依赖变化而重新执行。
    if (!engineReady) return;
    // 生成期间暂停轮询：/v1/myriad/stats 是 async def 里做同步 GPU 操作
    // (28 次 .cpu() + topk)，会阻塞事件循环并卡在 SSE 的间隙上。
    if (isGenerating) return;
    // 熔断：处于退避窗口内则跳过
    if (breakerRef.current.shouldSkip()) return;

    setIsLoadingStats(true);
    try {
      const data = await fetchStats(config);
      setStats(data);
      breakerRef.current.recordSuccess();
    } catch (err) {
      // 503「尚未就绪」是预期状态，不算失败、不污染熔断计数
      if (err instanceof MyriadApiError && err.status === 503) return;
      breakerRef.current.recordFailure();
      // 注意：这里**不**写入任何假数据。fetchStats 只有在传输层失败
      // 且用户显式开启了 mock 时才会返回模拟数据。
      if (err instanceof MyriadApiError && !err.isTransport) {
        setHealthError(err.describe(config.baseUrl, lang));
      }
    } finally {
      setIsLoadingStats(false);
    }
  }, [config, isGenerating, engineReady, lang]);

  // 连通性探测
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      const res = await testConnection(config, lang);
      if (!isMounted) return;
      setBackendOnline(res.ok);
      // 服务活着 ≠ 模型就绪。加载期是正常状态，不该显示成红色报错。
      setEngineReady(res.ready === true);
      setCapability(res.capability ?? null);
      setHealthError(res.ok ? null : res.error || null);
      if (res.ok) breakerRef.current.recordSuccess();
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [config.baseUrl, config.apiKey, lang]);

  // 遥测轮询
  useEffect(() => {
    refreshStats();
    const timer = setInterval(() => {
      refreshStats();
    }, Math.max(1000, config.pollIntervalMs || 5000));
    return () => clearInterval(timer);
  }, [refreshStats, config.pollIntervalMs]);

  // 发送消息。
  // 注意用 messagesRef 拿最新 messages：handleRegenerate 里会在同一次事件循环里
  // 先改 messages 再调本函数，直接读闭包里的 messages 会拿到旧值。
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (abortControllerRef.current) return; // 正在生成
      // 只读令牌不能消耗算力生成，提前拦下（服务端也会 403 兜底）
      if (capability?.permission === 'read') {
        setMessages(prev => [
          ...prev,
          {
            id: `msg-${Date.now()}-ro`,
            role: 'assistant',
            content: t('app.readonlyBlock'),
            createdAt: Date.now(),
            excludeFromContext: true,
          },
        ]);
        return;
      }

      // /clear 是纯本地操作：服务端无状态，真正的清空必须由客户端做。
      // 之前只把它当普通文本回复，messages 原封不动，下一轮照旧全量回传。
      if (trimmed === '/clear' || trimmed.startsWith('/clear ')) {
        const now = Date.now();
        messagesRef.current = [
          {
            id: `msg-${now}`,
            role: 'assistant',
            content: t('app.cleared'),
            createdAt: now,
            isCommand: true,
            excludeFromContext: true,
          },
        ];
        setMessages(messagesRef.current);
        return;
      }

      const base = messagesRef.current;
      const now = Date.now();
      const userMessage: ChatMessage = {
        id: `msg-${now}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: trimmed,
        createdAt: now,
      };
      const assistantMsgId = `asst-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning_content: '',
        isStreaming: true,
        createdAt: now,
      };

      setMessages([...base, userMessage, assistantMessage]);
      setIsGenerating(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // 滑动窗口：system 提示词 + 最近 N 轮。剔除本地提示与空回复。
      const ctx = buildContext([...base, userMessage], config.systemPrompt || '', config.contextRounds);
      const apiMessages = ctx.messages;
      lastContextRef.current = {
        rounds: ctx.rounds,
        kept: ctx.after,
        dropped: ctx.dropped,
        total: ctx.before,
      };
      setLastContext(lastContextRef.current);

      const patchAssistant = (patch: Partial<ChatMessage>) => {
        setMessages(prev => prev.map(m => (m.id === assistantMsgId ? { ...m, ...patch } : m)));
      };

      // 累加器：SSE 可能在同一个 tick 内推送多个分片，若从 state/ref 读回当前文本
      // 会拿到过期值导致丢字。这里同步累加，只负责触发渲染。
      let accContent = '';
      let accReasoning = '';

      try {
        await streamChatCompletion(config, apiMessages, {
          onReasoningDelta: delta => {
            accReasoning += delta;
            patchAssistant({ reasoning_content: accReasoning });
          },
          onContentDelta: delta => {
            accContent += delta;
            patchAssistant({ content: accContent });
          },
          onDone: finalData => {
            patchAssistant({
              isStreaming: false,
              thinkingTime: finalData.totalTimeSec,
              isCommand: finalData.isCommand,
              usage: finalData.usage,
              telemetry: finalData.telemetry,
              metrics: {
                elapsed_sec: Number(finalData.totalTimeSec.toFixed(3)),
                tokens_per_sec: finalData.tokensPerSec,
                ttft_sec: finalData.ttftSec,
              },
            });
            setIsGenerating(false);
            abortControllerRef.current = null;
            refreshStats();
          },
          onError: err => {
            const detail =
              err instanceof MyriadApiError ? err.describe(config.baseUrl, lang) : err?.message || t('err.connFail');
            patchAssistant({
              isStreaming: false,
              content: t('app.genFail', { d: detail }),
              // 标记为不参与上下文，避免下一轮把报错文本喂回模型
              excludeFromContext: true,
            });
            setIsGenerating(false);
            abortControllerRef.current = null;
          },
        }, abortController.signal);
      } catch {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [config, refreshStats, t, lang],
  );

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleClearMessages = () => {
    setMessages([]);
    localStorage.removeItem('myriad_chat_history');
  };

  /**
   * 重新生成最后一条回答。
   * 关键修复：不能先 setMessages(slice) 再调 handleSendMessage ——
   * 后者闭包里的 messages 仍是旧值，会把上一条助手回答一起发回服务端。
   * 这里直接同步更新 messagesRef，再触发发送。
   */
  const handleRegenerate = () => {
    if (isGenerating || messages.length === 0) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;

    const lastUserMsg = messages[lastUserIdx].content;
    const truncated = messages.slice(0, lastUserIdx);
    messagesRef.current = truncated;
    setMessages(truncated);
    handleSendMessage(lastUserMsg);
  };

  const status: ConnStatus = !backendOnline
    ? isMockMode
      ? 'mock'
      : 'offline'
    : engineReady
      ? 'online'
      : 'loading';

// 只读令牌：禁用一切写操作（神经手术 / 调频 / 插卡带 / 生成）
const canWrite = !capability || capability.permission !== 'read';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#070a10] text-slate-100 font-sans selection:bg-cyan-500/25 selection:text-cyan-200">
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        <ChatArea
          messages={messages}
          isGenerating={isGenerating}
          onSendMessage={handleSendMessage}
          onStopGeneration={handleStopGeneration}
          onClearMessages={handleClearMessages}
          onRegenerate={handleRegenerate}
          config={config}
          onOpenConfig={() => setIsConfigOpen(true)}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
          status={status}
          statusDetail={healthError}
          isMockMode={isMockMode}
          mockReason={mockReason}
          engineReady={engineReady}
          capability={capability}
          canWrite={canWrite}
          lastContext={lastContext}
          contextRounds={clampRounds(config.contextRounds)}
        />
      </div>

      <div
        className={`h-full transition-all duration-300 ease-in-out shrink-0 ${
          isSidebarOpen
            ? 'w-full sm:w-[420px] md:w-[460px] lg:w-[500px] border-l border-slate-800'
            : 'w-0 border-l-0 overflow-hidden'
        }`}
      >
        <NeuralDashboard
          stats={stats}
          config={config}
          onRefreshStats={refreshStats}
          isLoadingStats={isLoadingStats}
          isMockMode={isMockMode}
          canWrite={canWrite}
        />
      </div>

      <ConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        config={config}
        stats={stats}
        capability={capability}
        onSaveConfig={handleSaveConfig}
      />
    </div>
  );
}