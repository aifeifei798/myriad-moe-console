import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, BrainCircuit, Activity } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useLang } from '../lib/i18n';

interface DeepThinkingCardProps {
  reasoning: string;
  isStreaming?: boolean;
  thinkingTime?: number;
}

export const DeepThinkingCard: React.FC<DeepThinkingCardProps> = ({
  reasoning,
  isStreaming = false,
  thinkingTime,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [elapsed, setElapsed] = useState<number>(thinkingTime || 0);
  const { t } = useLang();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isStreaming) {
      // 以组件挂载时刻为起点做实时计时
      const start = performance.now();
      setElapsed(0);
      timer = setInterval(() => {
        setElapsed(Number(((performance.now() - start) / 1000).toFixed(1)));
      }, 100);
    } else if (thinkingTime !== undefined) {
      setElapsed(thinkingTime);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isStreaming, thinkingTime]);

  if (!reasoning && !isStreaming) return null;

  return (
    <div className="mb-3.5 rounded-lg border border-slate-800/80 bg-[#0a0e17] overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-[#111726]/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex items-center justify-center w-5 h-5 rounded bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 shrink-0">
            {isStreaming ? (
              <Activity className="w-3 h-3 animate-pulse text-cyan-400" />
            ) : (
              <BrainCircuit className="w-3 h-3 text-cyan-400" />
            )}
          </div>

          <span className="font-medium text-slate-200 tracking-wide flex items-center gap-1.5 truncate">
            {isStreaming ? (
              <>
                <span className="text-cyan-400">{t('thinking.active')}</span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              </>
            ) : (
              <span className="text-slate-300">{t('thinking.done')}</span>
            )}
          </span>

          <span className="text-slate-500 font-mono text-[11px] ml-1 shrink-0">
            {elapsed > 0 ? `(${elapsed}s)` : ''}
          </span>
        </div>

        <div className="flex items-center gap-2 text-slate-400 shrink-0">
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            {isOpen ? t('thinking.collapse') : t('thinking.expand')}
          </span>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-800/50 bg-[#080b12]">
          <div className="font-mono text-xs text-slate-400 leading-relaxed max-h-96 overflow-y-auto pr-1 selection:bg-cyan-900/40">
            <MarkdownRenderer content={reasoning} className="prose-p:my-1 prose-p:text-xs text-slate-400" />
            {isStreaming && (
              <span className="inline-block w-2 h-3.5 ml-1 bg-cyan-400/80 animate-pulse align-middle" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};