import React, { useState, useEffect } from 'react';
import { X, Settings, RefreshCw, Eye, EyeOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ClientConfig, TelemetryStats } from '../types/myriad';
import { testConnection } from '../services/myriadApi';
import { MyriadApiError } from '../services/apiError';
import { useClusterNames, useModelShape } from '../services/mockEngine';
import { MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS, clampRounds } from '../lib/contextWindow';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ClientConfig;
  stats: TelemetryStats | null;
  onSaveConfig: (newConfig: ClientConfig) => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  stats,
  onSaveConfig,
}) => {
  const [formData, setFormData] = useState<ClientConfig>({ ...config });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string; model?: string } | null>(
    null,
  );
  const [isTesting, setIsTesting] = useState<boolean>(false);

  // 每次打开时同步最新的外部配置
  useEffect(() => {
    if (isOpen) setFormData({ ...config });
  }, [isOpen, config]);

  const clusterNames = useClusterNames(stats);
  const { clusters, layers } = useModelShape(stats);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await testConnection(formData);
    setTestResult(result);
    setIsTesting(false);
  };

  const handleSave = () => {
    onSaveConfig(formData);
    onClose();
  };

  const toggleFocusCluster = (cid: number) => {
    const set = new Set(formData.focusClusters);
    if (set.has(cid)) set.delete(cid);
    else set.add(cid);
    setFormData({ ...formData, focusClusters: Array.from(set).sort((a, b) => a - b) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#0b101c] border border-slate-800 rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col text-slate-200 font-mono text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0e1424]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-cyan-950/60 border border-cyan-800/80 flex items-center justify-center text-cyan-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Myriad-MoE 连接与推理配置</h3>
              <p className="text-[11px] text-slate-400">OpenAI 兼容端点及神经扩展控制</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>API Base URL</span>
              <span className="text-[10px] text-slate-500">需包含 /v1 前缀</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.baseUrl}
                onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="http://127.0.0.1:8000/v1"
                className="flex-1 bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none min-w-0"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors shrink-0 flex items-center gap-1.5"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                测试连通
              </button>
            </div>

            {testResult && (
              <div
                className={`mt-1.5 p-2 rounded text-[11px] border ${
                  testResult.ok
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {testResult.ok
                      ? `✅ 连通成功 (${testResult.latencyMs}ms)${testResult.model ? ` · ${testResult.model}` : ''}`
                      : `❌ 连通失败: ${testResult.error}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>API Key</span>
              <span className="text-[10px] text-slate-500">服务端未设 --api-key 时可留空</span>
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={formData.apiKey}
                onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="sk-myriad (可选)"
                className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 pr-10 text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium">模型标识 (Model ID)</label>
            <input
              type="text"
              value={formData.model}
              onChange={e => setFormData({ ...formData, model: e.target.value })}
              className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>System 提示词</span>
              <span className="text-[10px] text-slate-500">始终置于上下文首条</span>
            </label>
            <textarea
              value={formData.systemPrompt}
              onChange={e => setFormData({ ...formData, systemPrompt: e.target.value })}
              rows={3}
              placeholder="留空则不发送 system 消息。例：你是一个擅长数学推导的助手。"
              className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none resize-none leading-relaxed"
            />
          </div>

          {/* 上下文保留轮数 */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>上下文保留轮数</span>
              <span className="text-[10px] text-cyan-400 font-bold">{formData.contextRounds} 轮</span>
            </label>
            <input
              type="range"
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              step={1}
              value={clampRounds(formData.contextRounds)}
              onChange={e => setFormData({ ...formData, contextRounds: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] text-slate-400 font-mono">
              <span>{MIN_ROUNDS} (省算力)</span>
              <span>默认 {DEFAULT_ROUNDS}</span>
              <span>{MAX_ROUNDS} (长记忆)</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              发送时只保留 System + 最近 {clampRounds(formData.contextRounds)} 轮，其余历史会被裁掉。
              服务端无状态，过长的 prompt 会挤占 KV 缓存并拖慢首字延迟。
            </p>
          </div>

          {/* Temperature / Top-P */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-300">Temperature</span>
                <span className="text-cyan-400 font-bold">{formData.temperature}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={formData.temperature}
                onChange={e => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-300">Top-P</span>
                <span className="text-cyan-400 font-bold">{formData.topP}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={formData.topP}
                onChange={e => setFormData({ ...formData, topP: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          {/* Max Tokens / Rep Penalty */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-slate-300">最大回复 Tokens</span>
              <input
                type="number"
                min="64"
                max="8192"
                step="64"
                value={formData.maxTokens}
                onChange={e => setFormData({ ...formData, maxTokens: parseInt(e.target.value, 10) || 512 })}
                className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <span className="text-slate-300">重复惩罚 (Rep Penalty)</span>
              <input
                type="number"
                min="1.0"
                max="2.0"
                step="0.05"
                value={formData.repetitionPenalty}
                onChange={e =>
                  setFormData({ ...formData, repetitionPenalty: parseFloat(e.target.value) || 1.15 })
                }
                className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 遥测轮询间隔 */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>看板轮询间隔</span>
              <span className="text-[10px] text-slate-500">生成期间自动暂停</span>
            </label>
            <select
              value={formData.pollIntervalMs}
              onChange={e => setFormData({ ...formData, pollIntervalMs: Number(e.target.value) })}
              className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value={2000}>2 秒 (较激进)</option>
              <option value={5000}>5 秒 (推荐)</option>
              <option value={10000}>10 秒</option>
              <option value={30000}>30 秒 (低功耗)</option>
            </select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              统计端点会在服务端做同步 GPU 操作，间隔过短会拖慢流式吐字。
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <label className="flex items-center justify-between p-2 rounded-lg bg-[#121929] border border-slate-800/80 cursor-pointer">
              <div>
                <span className="text-slate-200 font-medium block">独立思维链分流 (Split Reasoning)</span>
                <span className="text-[10px] text-slate-400">将 &lt;think&gt; 解析为 reasoning_content 折叠卡片</span>
              </div>
              <input
                type="checkbox"
                checked={formData.splitReasoning}
                onChange={e => setFormData({ ...formData, splitReasoning: e.target.checked })}
                className="w-4 h-4 accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex items-start justify-between p-2 rounded-lg bg-[#121929] border border-slate-800/80 cursor-pointer gap-3">
              <div className="min-w-0">
                <span className="text-slate-200 font-medium block">离线演示兜底 (Mock Fallback)</span>
                <span className="text-[10px] text-slate-400 leading-relaxed block mt-0.5">
                  <b className="text-amber-300">仅在无法连接服务时</b>启用虚拟推理机。
                  API Key 错误、地址错误、模型未就绪等真实错误<b className="text-rose-300">不会</b>被兜底，会如实报错。
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.mockFallback}
                onChange={e => setFormData({ ...formData, mockFallback: e.target.checked })}
                className="w-4 h-4 accent-cyan-400 cursor-pointer mt-0.5 shrink-0"
              />
            </label>

            {formData.mockFallback && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-950/30 border border-amber-800/50 text-[10px] text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>兜底启用时，所有回答与看板数值都会标注「模拟数据」横幅，请勿据此评估模型表现。</span>
              </div>
            )}
          </div>

          {/* Focus Clusters */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-slate-200 font-medium block">限定参战宗门 (Focus Clusters)</span>
                <span className="text-[10px] text-slate-400">
                  {formData.focusClusters.length === 0
                    ? `默认全部 ${clusters} 宗门参战`
                    : `已限定 ${formData.focusClusters.length} 个宗门（其余将被临时打入冷宫）`}
                </span>
              </div>
              {formData.focusClusters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, focusClusters: [] })}
                  className="text-[10px] text-cyan-400 hover:underline shrink-0"
                >
                  清空限定
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 bg-[#121929] rounded-lg border border-slate-800">
              {clusterNames.slice(0, clusters).map((name, cid) => {
                const selected = formData.focusClusters.includes(cid);
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => toggleFocusCluster(cid)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                      selected
                        ? 'bg-cyan-600 text-cyan-50 font-bold'
                        : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    #{cid.toString().padStart(2, '0')} {name}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500">
              生效范围：当前 {layers} 层 · 请求级临时覆盖，不改变禁闭所状态。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2 bg-[#0e1424]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors"
          >
            保存并应用配置
          </button>
        </div>
      </div>
    </div>
  );
};