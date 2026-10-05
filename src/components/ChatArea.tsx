import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Sparkles,
  Terminal,
  Trash2,
  Copy,
  Check,
  Cpu,
  Bot,
  User,
  Zap,
  Sliders,
  ChevronRight,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { ChatMessage, ClientConfig, ServerCapability } from '../types/myriad';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DeepThinkingCard } from './DeepThinkingCard';

export type ConnStatus = 'online' | 'offline' | 'mock' | 'loading';

interface ChatAreaProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSendMessage: (text: string) => void;
  onStopGeneration: () => void;
  onClearMessages: () => void;
  onRegenerate: () => void;
  config: ClientConfig;
  onOpenConfig: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  status: ConnStatus;
  statusDetail?: string | null;
  isMockMode: boolean;
  mockReason: string;
  engineReady: boolean;
  capability?: ServerCapability | null;
  canWrite: boolean;
  lastContext?: { rounds: number; kept: number; dropped: number; total: number } | null;
  contextRounds: number;
}

const SLASH_COMMANDS = [
  { cmd: '/catch', desc: '扫描 28 层逐层主导宗门雷达' },
  { cmd: '/stats', desc: '获取文理双核与全息遥测看板' },
  { cmd: '/clusters', desc: '列出 20 宗门命中与禁闭状态' },
  { cmd: '/show_k', desc: '显示各层开核数与并发配置' },
  { cmd: '/set_k <层> <核数>', desc: '单层开核数调频' },
  { cmd: '/set_k_all 2', desc: '全局 28 层统一开核数调频' },
  { cmd: '/cage <宗门>', desc: '全局禁闭某宗门 (如 /cage 16)' },
  { cmd: '/free <宗门>', desc: '释放某宗门 (会恢复其所有被封杀层)' },
  { cmd: '/snipe <层> <宗门>', desc: '单层狙击 (如 /snipe 21 16)' },
  { cmd: '/graph', desc: '切换 CUDA Graph 极速引擎' },
  { cmd: '/clear', desc: '清空本地上下文' },
  { cmd: '/help', desc: '查看全部 Myriad 命令指南' },
];

const STATUS_STYLE: Record<ConnStatus, { dot: string; chip: string; label: string }> = {
  online: {
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-950/60 text-emerald-400 border-emerald-800',
    label: '服务在线',
  },
  mock: {
    dot: 'bg-amber-400 animate-pulse',
    chip: 'bg-amber-950/60 text-amber-300 border-amber-800',
    label: '模拟演示中',
  },
  offline: {
    dot: 'bg-rose-400',
    chip: 'bg-rose-950/60 text-rose-300 border-rose-800',
    label: '服务离线',
  },
  loading: {
    dot: 'bg-sky-400 animate-pulse',
    chip: 'bg-sky-950/60 text-sky-300 border-sky-800',
    label: '模型加载中',
  },
};

const pad2 = (n: number) => n.toString().padStart(2, '0');

/** 单条回答的本次请求遥测条：文理占比 + CUDA Graph + 主导宗门。 */
const TelemetryStrip: React.FC<{ telemetry: NonNullable<ChatMessage['telemetry']> }> = ({ telemetry }) => {
  const arts = telemetry.arts_core_pct;
  const sci = telemetry.sci_core_pct;
  const top = telemetry.top_clusters?.slice(0, 3) ?? [];
  return (
    <div className="mt-2 pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
      <span className="text-slate-500">本次路由</span>
      {arts != null && sci != null && (
        <span className="flex items-center gap-1.5">
          <span className="w-16 h-1.5 rounded bg-slate-800 overflow-hidden flex shrink-0">
            <span className="h-full bg-blue-500" style={{ width: `${arts}%` }} />
            <span className="h-full bg-amber-500" style={{ width: `${sci}%` }} />
          </span>
          <span className="text-blue-400">文 {arts}%</span>
          <span className="text-amber-400">理 {sci}%</span>
        </span>
      )}
      {telemetry.cuda_graph != null && (
        <span className={telemetry.cuda_graph ? 'text-amber-400' : 'text-slate-500'}>
          {telemetry.cuda_graph ? '⚡ CUDA Graph' : 'Eager'}
        </span>
      )}
      {top.length > 0 && (
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-500">主导</span>
          {top.map(c => (
            <span key={c.id} className={c.caged ? 'text-rose-400 line-through' : 'text-cyan-400'}>
              #{pad2(c.id)} {c.name}
            </span>
          ))}
        </span>
      )}
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isGenerating,
  onSendMessage,
  onStopGeneration,
  onClearMessages,
  onRegenerate,
  config,
  onOpenConfig,
  onToggleSidebar,
  isSidebarOpen,
  status,
  statusDetail,
  isMockMode,
  mockReason,
  engineReady,
  capability,
  canWrite,
  lastContext,
  contextRounds,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!inputText.trim() || isGenerating) return;
    // 只读令牌下仍允许发送：handleSendMessage 会给出明确提示而不是静默失败
    onSendMessage(inputText.trim());
    setInputText('');
    setShowCommands(false);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSelectCommand = (cmd: string) => {
    setInputText(cmd);
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  const style = STATUS_STYLE[status];

  // 最后一条用户消息之后是否存在可重新生成的助手回答
  const canRegenerate = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i < messages.length - 1 && messages[i + 1].role === 'assistant';
      }
    }
    return false;
  })();

  return (
    <div className="flex flex-col h-full bg-[#080b11] text-slate-200 relative overflow-hidden">
      {/* Top Header Bar */}
      <div className="h-14 border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between bg-[#0a0e17]/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600/30 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-sm shadow-cyan-500/10">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-slate-100 font-mono tracking-wide">
                Myriad-MoE 交互工作台
              </h1>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${style.chip}`}
                title={statusDetail || undefined}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              {capability?.permission === 'read' && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-violet-950/60 text-violet-300 border-violet-800"
                  title="当前令牌仅可读取遥测，写操作会被服务端拒绝 (403)"
                >
                  <Lock className="w-2.5 h-2.5" />
                  只读
                </span>
              )}
              {capability?.authRequired === false && status !== 'offline' && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-amber-950/60 text-amber-300 border-amber-800"
                  title="服务端未设置 --api-key / --read-only-key，任何人都可操作"
                >
                  未鉴权
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono hidden sm:block">
              模型: {config.model} · 双大核协同 · 25,200 微专家
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={onClearMessages}
              title="清空对话记忆"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors text-xs flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline font-mono text-[11px]">重置会话</span>
            </button>
          )}

          <button
            onClick={onOpenConfig}
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800/80 transition-colors text-xs flex items-center gap-1 font-mono"
            title="配置 Base URL 与推理参数"
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden md:inline text-[11px]">配置中心</span>
          </button>

          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1.5 ${
              isSidebarOpen
                ? 'bg-cyan-950/60 border-cyan-800 text-cyan-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="展开/折叠神经透视监控看板"
          >
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline text-[11px]">{isSidebarOpen ? '收起看板' : '全息监控台'}</span>
          </button>
        </div>
      </div>

      {/* 只读令牌提示 */}
      {!canWrite && status === 'online' && (
        <div className="px-4 sm:px-6 py-2 flex items-center gap-2 text-[11px] font-mono border-b bg-violet-950/30 border-violet-900/60 text-violet-200">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <b>只读模式</b>
            <span className="opacity-75">
              　可查看看板遥测，但无法生成回答或执行宗门禁闭 / 狙击 / 调频 / 热插拔。
              需要这些能力请在「配置中心」改用管理员 API Key。
            </span>
          </span>
          <button onClick={onOpenConfig} className="shrink-0 underline hover:no-underline">
            切换 Key
          </button>
        </div>
      )}

      {/* 模拟数据 / 离线 / 加载中横幅 —— 之前 mock 兜底是完全静默的 */}
      {(isMockMode || status === 'offline' || status === 'loading') && (
        <div
          className={`px-4 sm:px-6 py-2 flex items-center gap-2 text-[11px] font-mono border-b ${
            isMockMode
              ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
              : status === 'loading'
                ? 'bg-sky-950/30 border-sky-900/60 text-sky-200'
                : 'bg-rose-950/30 border-rose-900/60 text-rose-200'
          }`}
        >
          {status === 'loading' ? (
            <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            {isMockMode ? (
              <>
                <b>当前为本地模拟数据</b>，并非真实模型输出
                {mockReason ? <span className="opacity-75"> · 原因：{mockReason}</span> : null}
              </>
            ) : status === 'loading' ? (
              <>
                <b>推理服务已启动，模型权重仍在加载</b>
                <span className="opacity-75"> · 加载完成后即可对话，看板会自动开始刷新</span>
              </>
            ) : (
              <>
                <b>推理服务未连接</b>
                {statusDetail ? <span className="opacity-75"> · {statusDetail}</span> : null}
              </>
            )}
          </span>
          {status !== 'loading' && (
            <button onClick={onOpenConfig} className="shrink-0 underline hover:no-underline">
              打开配置
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto my-auto pt-8 text-center space-y-6">
            <div className="inline-flex p-3 rounded-2xl bg-cyan-950/40 border border-cyan-800/50 text-cyan-400 shadow-lg shadow-cyan-950/50 mb-2">
              <Zap className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-100 font-mono">
                Myriad-MoE 神经全息客户端
              </h2>
              <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                已对接本地私有化部署的 25,200 微专家大模型服务。支持全息神经透视、思维链折叠推演、逐层开核与宗门实时禁闭。
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl mx-auto pt-2 text-left font-mono">
              <button
                onClick={() => onSendMessage('测试文理双核算力协同，推导快速排序并给出复杂度评估')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  文理双核算力测试
                </div>
                <div className="text-[11px] text-slate-400">
                  评估文科常识基盘与理科宏核的动态算力分配与数学推导
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/catch')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  执行 /catch 神经雷达扫描
                </div>
                <div className="text-[11px] text-slate-400">
                  检测 28 层网络中各层激活拍数与主导宗门，排查异常波动
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/stats')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  查看全息看板 (/stats)
                </div>
                <div className="text-[11px] text-slate-400">
                  获取当前文理占比、Top 宗门活跃排行及 CUDA Graph 状态
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/clusters')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  检查 20 宗门状态 (/clusters)
                </div>
                <div className="text-[11px] text-slate-400">
                  查看各宗门总命中数、禁闭所关押状态及特区卡带挂载
                </div>
              </button>
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-4xl mx-auto ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-[#0e1627] border border-cyan-800/60 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5 shadow-sm shadow-cyan-950/40">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`group relative rounded-2xl px-4 py-3.5 transition-all ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-blue-600/90 to-cyan-600/90 text-white max-w-[85%] sm:max-w-[75%] rounded-tr-none shadow-md shadow-cyan-950/20'
                    : 'bg-[#0d121e] border border-slate-800/80 text-slate-200 w-full max-w-[92%] sm:max-w-[88%] rounded-tl-none'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/60 text-[11px] font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-cyan-400 tracking-wide">{config.model}</span>
                      {msg.isCommand && (
                        <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px]">
                          ⚡ 指令响应
                        </span>
                      )}
                      {msg.excludeFromContext && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]"
                          title="本地提示，不会作为上下文回传给模型"
                        >
                          本地提示
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-slate-500">
                      {msg.metrics?.ttft_sec != null && (
                        <span title="首字延迟">TTFT {msg.metrics.ttft_sec.toFixed(2)}s</span>
                      )}
                      {msg.metrics?.tokens_per_sec ? (
                        <span>{msg.metrics.tokens_per_sec} tok/s</span>
                      ) : null}
                      {msg.metrics?.elapsed_sec ? (
                        <span>{msg.metrics.elapsed_sec.toFixed(2)}s</span>
                      ) : null}
                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-slate-300 transition-opacity"
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {msg.role === 'assistant' && (msg.reasoning_content || msg.isStreaming) && (
                  <DeepThinkingCard
                    reasoning={msg.reasoning_content || ''}
                    isStreaming={msg.isStreaming && !msg.content}
                    thinkingTime={msg.thinkingTime}
                  />
                )}

                {msg.content ? (
                  <MarkdownRenderer content={msg.content} />
                ) : msg.isStreaming ? (
                  <div className="flex items-center gap-1.5 py-2 text-xs font-mono text-cyan-400">
                    <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                    <span>正在调度神经微专家生成解答...</span>
                  </div>
                ) : null}

                {msg.role === 'user' && (
                  <button
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-cyan-200 hover:text-white transition-opacity"
                    title="复制消息"
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3 h-3 text-emerald-300" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                )}

                {/* 本次问答专属的全息遥测（服务端流式末尾下发） */}
                {msg.role === 'assistant' && msg.telemetry && <TelemetryStrip telemetry={msg.telemetry} />}
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {/* 重新生成：挂在最后一条助手回答下方 */}
        {canRegenerate && !isGenerating && (
          <div className="max-w-4xl mx-auto flex justify-start pl-11">
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-800/70 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              <ChevronRight className="w-3 h-3 rotate-180" />
              重新生成
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Slash Commands Dropup */}
      {showCommands && (
        <div className="absolute bottom-24 left-4 right-4 sm:left-6 sm:right-6 max-w-3xl mx-auto z-20 bg-[#0c121e] border border-cyan-800/80 rounded-xl shadow-2xl p-2 font-mono text-xs">
          <div className="px-3 py-1.5 text-[10px] text-cyan-400 font-bold uppercase tracking-wider border-b border-slate-800 flex justify-between">
            <span>Myriad-MoE 原生斜杠指令</span>
            <span>点击填入输入框</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-1 max-h-48 overflow-y-auto">
            {SLASH_COMMANDS.map(item => (
              <button
                key={item.cmd}
                onClick={() => handleSelectCommand(item.cmd)}
                className="p-2 rounded-lg hover:bg-cyan-950/60 hover:text-cyan-300 text-left transition-colors flex items-center justify-between group"
              >
                <span className="font-semibold text-cyan-400 group-hover:underline">{item.cmd}</span>
                <span className="text-[10px] text-slate-400 truncate ml-2">{item.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Box Area */}
      <div className="p-4 sm:px-6 bg-[#0a0e17]/90 border-t border-slate-800/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto relative">
          <div className="relative rounded-xl bg-[#0e1424] border border-slate-700/80 focus-within:border-cyan-500/80 focus-within:ring-1 focus-within:ring-cyan-500/30 transition-all shadow-lg">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => {
                const val = e.target.value;
                setInputText(val);
                setShowCommands(val.startsWith('/'));
              }}
              onKeyDown={handleKeyDown}
              placeholder="发送消息，或输入 / 调用神经透视指令（如 /catch、/stats、/show_k）..."
              rows={1}
              className="w-full bg-transparent px-4 py-3.5 pr-24 text-slate-100 placeholder-slate-500 resize-none focus:outline-none text-[13.5px] leading-relaxed font-sans max-h-48"
            />

            <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowCommands(!showCommands)}
                title="常用指令列表"
                className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800/80 transition-colors"
              >
                <Terminal className="w-4 h-4" />
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-sm shadow-rose-900/40"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono text-[11px]">打断</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!inputText.trim()}
                  className="p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white transition-all shadow-sm shadow-cyan-600/30"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 px-1 text-[11px] font-mono text-slate-500 gap-3">
            <span className="truncate">Enter 提交 · Shift + Enter 换行 · 输入 / 唤出指令</span>
            <div className="flex items-center gap-3 shrink-0">
              {lastContext && lastContext.dropped > 0 && (
                <span
                  className="text-amber-400/90"
                  title={`原 ${lastContext.total} 条消息，已裁剪为最近 ${lastContext.rounds} 轮（保留 ${lastContext.kept} 条）`}
                >
                  上下文 {lastContext.rounds}/{contextRounds} 轮 · 已裁掉 {lastContext.dropped} 条
                </span>
              )}
              <span className="text-slate-500 hidden sm:inline truncate max-w-[40%]">
                Base URL: {config.baseUrl}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};