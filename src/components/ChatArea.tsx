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
import { useLang, LangToggle, type ZhKey } from '../lib/i18n';

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

const SLASH_CMDS: Array<{ cmdZh: string; cmdEn: string; descKey: ZhKey }> = [
  { cmdZh: '/catch', cmdEn: '/catch', descKey: 'slash.catch' },
  { cmdZh: '/stats', cmdEn: '/stats', descKey: 'slash.stats' },
  { cmdZh: '/clusters', cmdEn: '/clusters', descKey: 'slash.clusters' },
  { cmdZh: '/show_k', cmdEn: '/show_k', descKey: 'slash.show_k' },
  { cmdZh: '/set_k <层> <核数>', cmdEn: '/set_k <layer> <k>', descKey: 'slash.set_k' },
  { cmdZh: '/set_k_all 2', cmdEn: '/set_k_all 2', descKey: 'slash.set_k_all' },
  { cmdZh: '/cage <宗门>', cmdEn: '/cage <cluster>', descKey: 'slash.cage' },
  { cmdZh: '/free <宗门>', cmdEn: '/free <cluster>', descKey: 'slash.free' },
  { cmdZh: '/snipe <层> <宗门>', cmdEn: '/snipe <layer> <cluster>', descKey: 'slash.snipe' },
  { cmdZh: '/graph', cmdEn: '/graph', descKey: 'slash.graph' },
  { cmdZh: '/clear', cmdEn: '/clear', descKey: 'slash.clear' },
  { cmdZh: '/help', cmdEn: '/help', descKey: 'slash.help' },
];

const pad2 = (n: number) => n.toString().padStart(2, '0');

/** 单条回答的本次请求遥测条：文理占比 + CUDA Graph + 主导宗门。 */
const TelemetryStrip: React.FC<{ telemetry: NonNullable<ChatMessage['telemetry']> }> = ({ telemetry }) => {
  const { t } = useLang();
  const arts = telemetry.arts_core_pct;
  const sci = telemetry.sci_core_pct;
  const top = telemetry.top_clusters?.slice(0, 3) ?? [];
  return (
    <div className="mt-2 pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
      <span className="text-slate-500">{t('telemetry.thisRoute')}</span>
      {arts != null && sci != null && (
        <span className="flex items-center gap-1.5">
          <span className="w-16 h-1.5 rounded bg-slate-800 overflow-hidden flex shrink-0">
            <span className="h-full bg-blue-500" style={{ width: `${arts}%` }} />
            <span className="h-full bg-amber-500" style={{ width: `${sci}%` }} />
          </span>
          <span className="text-blue-400">{t('telemetry.arts')} {arts}%</span>
          <span className="text-amber-400">{t('telemetry.sci')} {sci}%</span>
        </span>
      )}
      {telemetry.cuda_graph != null && (
        <span className={telemetry.cuda_graph ? 'text-amber-400' : 'text-slate-500'}>
          {telemetry.cuda_graph ? '⚡ CUDA Graph' : 'Eager'}
        </span>
      )}
      {top.length > 0 && (
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-500">{t('telemetry.leading')}</span>
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
  const { t, lang } = useLang();
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

  const STATUS_STYLE: Record<ConnStatus, { dot: string; chip: string; labelKey: ZhKey }> = {
    online: {
      dot: 'bg-emerald-400',
      chip: 'bg-emerald-950/60 text-emerald-400 border-emerald-800',
      labelKey: 'status.online',
    },
    mock: {
      dot: 'bg-amber-400 animate-pulse',
      chip: 'bg-amber-950/60 text-amber-300 border-amber-800',
      labelKey: 'status.mock',
    },
    offline: {
      dot: 'bg-rose-400',
      chip: 'bg-rose-950/60 text-rose-300 border-rose-800',
      labelKey: 'status.offline',
    },
    loading: {
      dot: 'bg-sky-400 animate-pulse',
      chip: 'bg-sky-950/60 text-sky-300 border-sky-800',
      labelKey: 'status.loading',
    },
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
                {t('header.title')}
              </h1>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${style.chip}`}
                title={statusDetail || undefined}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {t(style.labelKey)}
              </span>
              {capability?.permission === 'read' && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-violet-950/60 text-violet-300 border-violet-800"
                  title={t('header.readonlyTitle')}
                >
                  <Lock className="w-2.5 h-2.5" />
                  {t('header.readonly')}
                </span>
              )}
              {capability?.authRequired === false && status !== 'offline' && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-amber-950/60 text-amber-300 border-amber-800"
                  title={t('header.noAuthTitle')}
                >
                  {t('header.noAuth')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono hidden sm:block">
              {t('header.subtitle', { model: config.model })}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <LangToggle compact />
          {messages.length > 0 && (
            <button
              onClick={onClearMessages}
              title={t('header.resetSessionTitle')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors text-xs flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline font-mono text-[11px]">{t('header.resetSession')}</span>
            </button>
          )}

          <button
            onClick={onOpenConfig}
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800/80 transition-colors text-xs flex items-center gap-1 font-mono"
            title={t('header.configCenterTitle')}
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden md:inline text-[11px]">{t('header.configCenter')}</span>
          </button>

          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1.5 ${
              isSidebarOpen
                ? 'bg-cyan-950/60 border-cyan-800 text-cyan-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={t('header.toggleBoardTitle')}
          >
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline text-[11px]">{isSidebarOpen ? t('header.collapseBoard') : t('header.expandBoard')}</span>
          </button>
        </div>
      </div>

      {/* 只读令牌提示 */}
      {!canWrite && status === 'online' && (
        <div className="px-4 sm:px-6 py-2 flex items-center gap-2 text-[11px] font-mono border-b bg-violet-950/30 border-violet-900/60 text-violet-200">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <b>{t('banner.readonlyTitle')}</b>
            <span className="opacity-75">
              　{t('banner.readonlyBody')}
            </span>
          </span>
          <button onClick={onOpenConfig} className="shrink-0 underline hover:no-underline">
            {t('common.switchKey')}
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
                <b>{t('banner.mockTitle')}</b>，{t('banner.mockBody')}
                {mockReason ? <span className="opacity-75"> · {t('banner.mockReason')}{mockReason}</span> : null}
              </>
            ) : status === 'loading' ? (
              <>
                <b>{t('banner.loadingTitle')}</b>
                <span className="opacity-75"> · {t('banner.loadingBody')}</span>
              </>
            ) : (
              <>
                <b>{t('banner.offlineTitle')}</b>
                {statusDetail ? <span className="opacity-75"> · {statusDetail}</span> : null}
              </>
            )}
          </span>
          {status !== 'loading' && (
            <button onClick={onOpenConfig} className="shrink-0 underline hover:no-underline">
              {t('common.openConfig')}
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
                {t('empty.title')}
              </h2>
              <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                {t('empty.desc')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl mx-auto pt-2 text-left font-mono">
              <button
                onClick={() => onSendMessage(t('empty.card1Prompt'))}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  {t('empty.card1Title')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('empty.card1Desc')}
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/catch')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  {t('empty.card2Title')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('empty.card2Desc')}
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/stats')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  {t('empty.card3Title')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('empty.card3Desc')}
                </div>
              </button>

              <button
                onClick={() => onSendMessage('/clusters')}
                className="p-3 rounded-xl bg-[#0d1322] border border-slate-800 hover:border-cyan-700/60 hover:bg-[#101729] transition-all text-xs group text-left"
              >
                <div className="font-semibold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  {t('empty.card4Title')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('empty.card4Desc')}
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
                          {t('msg.commandBadge')}
                        </span>
                      )}
                      {msg.excludeFromContext && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]"
                          title={t('msg.localBadgeTitle')}
                        >
                          {t('msg.localBadge')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-slate-500">
                      {msg.metrics?.ttft_sec != null && (
                        <span title={t('msg.ttftTitle')}>TTFT {msg.metrics.ttft_sec.toFixed(2)}s</span>
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
                        title={t('common.copyContent')}
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
                    <span>{t('msg.streaming')}</span>
                  </div>
                ) : null}

                {msg.role === 'user' && (
                  <button
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-cyan-200 hover:text-white transition-opacity"
                    title={t('common.copyMessage')}
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
              {t('msg.regenerate')}
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Slash Commands Dropup */}
      {showCommands && (
        <div className="absolute bottom-24 left-4 right-4 sm:left-6 sm:right-6 max-w-3xl mx-auto z-20 bg-[#0c121e] border border-cyan-800/80 rounded-xl shadow-2xl p-2 font-mono text-xs">
          <div className="px-3 py-1.5 text-[10px] text-cyan-400 font-bold uppercase tracking-wider border-b border-slate-800 flex justify-between">
            <span>{t('slash.title')}</span>
            <span>{t('slash.hint')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-1 max-h-48 overflow-y-auto">
            {SLASH_CMDS.map(item => {
              const cmd = lang === 'en' ? item.cmdEn : item.cmdZh;
              return (
                <button
                  key={item.cmdZh}
                  onClick={() => handleSelectCommand(cmd)}
                  className="p-2 rounded-lg hover:bg-cyan-950/60 hover:text-cyan-300 text-left transition-colors flex items-center justify-between group"
                >
                  <span className="font-semibold text-cyan-400 group-hover:underline">{cmd}</span>
                  <span className="text-[10px] text-slate-400 truncate ml-2">{t(item.descKey)}</span>
                </button>
              );
            })}
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
              placeholder={t('input.placeholder')}
              rows={1}
              className="w-full bg-transparent px-4 py-3.5 pr-24 text-slate-100 placeholder-slate-500 resize-none focus:outline-none text-[13.5px] leading-relaxed font-sans max-h-48"
            />

            <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowCommands(!showCommands)}
                title={t('input.commandsTitle')}
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
                  <span className="font-mono text-[11px]">{t('input.interrupt')}</span>
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
            <span className="truncate">{t('input.hint')}</span>
            <div className="flex items-center gap-3 shrink-0">
              {lastContext && lastContext.dropped > 0 && (
                <span
                  className="text-amber-400/90"
                  title={t('input.ctxTrimmedTitle', { totalMsg: lastContext.total, rounds: lastContext.rounds, kept: lastContext.kept })}
                >
                  {t('input.ctxTrimmed', { rounds: lastContext.rounds, total: contextRounds, dropped: lastContext.dropped })}
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
