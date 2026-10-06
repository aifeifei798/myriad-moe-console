import React, { useState, useEffect } from 'react';
import { X, Settings, RefreshCw, Eye, EyeOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ClientConfig, TelemetryStats, ServerCapability } from '../types/myriad';
import { testConnection } from '../services/myriadApi';
import { MyriadApiError } from '../services/apiError';
import { useClusterNames, useModelShape } from '../services/mockEngine';
import { MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS, clampRounds } from '../lib/contextWindow';
import { useLang } from '../lib/i18n';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ClientConfig;
  stats: TelemetryStats | null;
  capability?: ServerCapability | null;
  onSaveConfig: (newConfig: ClientConfig) => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  stats,
  capability,
  onSaveConfig,
}) => {
  const { t, lang } = useLang();
  const [formData, setFormData] = useState<ClientConfig>({ ...config });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    model?: string;
    capability?: ServerCapability | null;
  } | null>(null);
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
    const result = await testConnection(formData, lang);
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
              <h3 className="text-sm font-semibold text-slate-100">{t('cfg.title')}</h3>
              <p className="text-[11px] text-slate-400">{t('cfg.subtitle')}</p>
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
              <span>{t('cfg.baseUrl')}</span>
              <span className="text-[10px] text-slate-500">{t('cfg.baseUrlHint')}</span>
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
                {t('cfg.testConn')}
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
                    {testResult.ok ? (
                      <>
                        {t('cfg.connOk', { ms: testResult.latencyMs })}
                        {testResult.model ? ` · ${testResult.model}` : ''}
                        {testResult.capability?.permission === 'read' && (
                          <span className="ml-1 text-amber-300">
                            {t('cfg.capReadonly')}
                          </span>
                        )}
                        {testResult.capability?.permission === 'admin' && (
                          <span className="ml-1 text-emerald-300">{t('cfg.capAdmin')}</span>
                        )}
                        {testResult.capability?.authRequired === false && (
                          <span className="ml-1 text-amber-300">{t('cfg.capNoAuth')}</span>
                        )}
                        {testResult.capability?.ready === false && (
                          <span className="ml-1 text-sky-300">{t('cfg.capLoading')}</span>
                        )}
                      </>
                    ) : (
                      t('cfg.connFail', { e: testResult.error ?? '' })
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>{t('cfg.apiKey')}</span>
              <span className="text-[10px] text-slate-500">
                {capability?.permission === 'read'
                  ? t('cfg.apiKeyReadonly')
                  : capability?.permission === 'admin'
                    ? t('cfg.apiKeyAdmin')
                    : t('cfg.apiKeyNone')}
              </span>
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={formData.apiKey}
                onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={t('cfg.apiKeyPh')}
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
            <label className="text-slate-300 font-medium">{t('cfg.modelId')}</label>
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
              <span>{t('cfg.systemPrompt')}</span>
              <span className="text-[10px] text-slate-500">{t('cfg.systemPromptHint')}</span>
            </label>
            <textarea
              value={formData.systemPrompt}
              onChange={e => setFormData({ ...formData, systemPrompt: e.target.value })}
              rows={3}
              placeholder={t('cfg.systemPromptPh')}
              className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none resize-none leading-relaxed"
            />
          </div>

          {/* 上下文保留轮数 */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium flex justify-between">
              <span>{t('cfg.ctxRounds')}</span>
              <span className="text-[10px] text-cyan-400 font-bold">{t('cfg.ctxRoundsUnit', { n: formData.contextRounds })}</span>
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
              <span>{t('cfg.ctxMin', { n: MIN_ROUNDS })}</span>
              <span>{t('cfg.ctxDefault', { n: DEFAULT_ROUNDS })}</span>
              <span>{t('cfg.ctxMax', { n: MAX_ROUNDS })}</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {t('cfg.ctxDesc', { n: clampRounds(formData.contextRounds) })}
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
              <span className="text-slate-300">{t('cfg.maxTokens')}</span>
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
              <span className="text-slate-300">{t('cfg.repPenalty')}</span>
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
              <span>{t('cfg.pollInterval')}</span>
              <span className="text-[10px] text-slate-500">{t('cfg.pollPause')}</span>
            </label>
            <select
              value={formData.pollIntervalMs}
              onChange={e => setFormData({ ...formData, pollIntervalMs: Number(e.target.value) })}
              className="w-full bg-[#121929] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value={2000}>{t('cfg.poll2')}</option>
              <option value={5000}>{t('cfg.poll5')}</option>
              <option value={10000}>{t('cfg.poll10')}</option>
              <option value={30000}>{t('cfg.poll30')}</option>
            </select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {t('cfg.pollDesc')}
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <label className="flex items-center justify-between p-2 rounded-lg bg-[#121929] border border-slate-800/80 cursor-pointer">
              <div>
                <span className="text-slate-200 font-medium block">{t('cfg.splitTitle')}</span>
                <span className="text-[10px] text-slate-400">{t('cfg.splitDesc')}</span>
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
                <span className="text-slate-200 font-medium block">{t('cfg.mockTitle')}</span>
                <span className="text-[10px] text-slate-400 leading-relaxed block mt-0.5">
                  {t('cfg.mockDesc')}
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
                <span>{t('cfg.mockWarn')}</span>
              </div>
            )}
          </div>

          {/* Focus Clusters */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-slate-200 font-medium block">{t('cfg.focusTitle')}</span>
                <span className="text-[10px] text-slate-400">
                  {formData.focusClusters.length === 0
                    ? t('cfg.focusAll', { c: clusters })
                    : t('cfg.focusSome', { n: formData.focusClusters.length })}
                </span>
              </div>
              {formData.focusClusters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, focusClusters: [] })}
                  className="text-[10px] text-cyan-400 hover:underline shrink-0"
                >
                  {t('cfg.focusClear')}
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
              {t('cfg.focusScope', { l: layers })}
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
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors"
          >
            {t('cfg.save')}
          </button>
        </div>
      </div>
    </div>
  );
};
