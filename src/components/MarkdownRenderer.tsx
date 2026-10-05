import React, { useMemo } from 'react';
import { marked } from 'marked';
import { Check, Copy } from 'lucide-react';
import { renderMath } from '../lib/mathRender';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

marked.setOptions({ gfm: true, breaks: true });

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return marked.parse(renderMath(content)) as string;
    } catch {
      // 渲染失败时退化成转义后的纯文本，避免整条消息消失
      return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [content]);

  return (
    <div
      className={`prose prose-invert max-w-none text-slate-200 leading-relaxed text-[14.5px]
        prose-headings:text-slate-100 prose-headings:font-medium prose-headings:tracking-tight
        prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-h1:border-b prose-h1:border-slate-800 prose-h1:pb-2
        prose-p:my-2 prose-p:leading-relaxed
        prose-ul:my-2 prose-ul:pl-5 prose-ol:my-2 prose-ol:pl-5
        prose-li:my-1 prose-li:leading-normal
        prose-strong:text-cyan-300 prose-strong:font-semibold
        prose-a:text-cyan-400 prose-a:underline
        prose-code:text-cyan-300 prose-code:bg-[#121927] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-[#0a0f1a] prose-pre:border prose-pre:border-slate-800/80 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-3
        prose-pre:code:bg-transparent prose-pre:code:p-0 prose-pre:code:text-slate-200
        prose-blockquote:border-l-cyan-500 prose-blockquote:bg-cyan-950/10 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:text-slate-400
        prose-table:my-3 prose-th:text-cyan-400 prose-th:bg-[#0f172a] prose-th:p-2 prose-th:border prose-th:border-slate-800
        prose-td:p-2 prose-td:border prose-td:border-slate-800 prose-tr:even:bg-[#0c121e]
        ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/** 复制按钮，供聊天气泡复用。 */
export const CopyButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={className}
      title="复制"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};