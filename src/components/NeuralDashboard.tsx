import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Zap,
  Cpu,
  Lock,
  Unlock,
  Crosshair,
  Radar,
  Disc,
  RotateCcw,
  RefreshCw,
  Sliders,
  ChevronRight,
  Layers,
  Server,
  Flame,
  CheckCircle2,
  AlertCircle,
  FileUp,
  X,
} from 'lucide-react';
import { TelemetryStats, CatchRadarResponse, ClientConfig } from '../types/myriad';
import {
  setTopK,
  cageCluster,
  freeCluster,
  snipeCluster,
  toggleCudaGraph,
  resetTelemetryStats,
  fetchCatchRadar,
  plugCartridge,
  plugCartridgeWithProgress,
} from '../services/myriadApi';
import { MyriadApiError } from '../services/apiError';
import { useClusterNames, useModelShape } from '../services/mockEngine';
import { useLang, type ZhKey } from '../lib/i18n';

interface NeuralDashboardProps {
  stats: TelemetryStats | null;
  config: ClientConfig;
  onRefreshStats: () => void;
  isLoadingStats?: boolean;
  isMockMode?: boolean;
  /** false = 只读令牌，所有写操作按钮禁用 */
  canWrite?: boolean;
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

export const NeuralDashboard: React.FC<NeuralDashboardProps> = ({
  stats,
  config,
  onRefreshStats,
  isLoadingStats = false,
  isMockMode = false,
  canWrite = true,
}) => {
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState<'overview' | 'clusters' | 'topk' | 'radar'>('overview');
  const [actionNotice, setActionNotice] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [targetScope, setTargetScope] = useState<'all' | 'layer'>('all');
  const [selectedLayer, setSelectedLayer] = useState<number>(0);
  const [topKValue, setTopKValue] = useState<number>(2);
  const [isApplyingTopK, setIsApplyingTopK] = useState<boolean>(false);

  // 单层狙击
  const [snipeLayer, setSnipeLayer] = useState<number>(0);
  const [snipeClusterId, setSnipeClusterId] = useState<number>(16);
  const [isSniping, setIsSniping] = useState<boolean>(false);

  const [radarData, setRadarData] = useState<CatchRadarResponse | null>(null);
  const [isLoadingRadar, setIsLoadingRadar] = useState<boolean>(false);

  const [cartridgePath, setCartridgePath] = useState<string>('cartridge_gongfang.pt');
  const [cartridgeSlot, setCartridgeSlot] = useState<number>(16);
  const [isPlugging, setIsPlugging] = useState<boolean>(false);
  // 本地文件上传
  const [cartridgeFile, setCartridgeFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 规模与宗门名一律以服务端遥测为准，改 --num-clusters 等启动参数也不会错位
  const clusterNames = useClusterNames(stats);
  const { layers, clusters, expertsPerCluster, totalExperts } = useModelShape(stats);

  useEffect(() => {
    if (snipeLayer >= layers) setSnipeLayer(Math.max(0, layers - 1));
    if (snipeClusterId >= clusters) setSnipeClusterId(Math.max(0, clusters - 1));
  }, [layers, clusters, snipeLayer, snipeClusterId]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setActionNotice({ msg, type });
    setTimeout(() => setActionNotice(null), 4000);
  };

  const describeError = (err: any) =>
    err instanceof MyriadApiError ? err.describe(config.baseUrl, lang) : err?.message || t('err.connFail');

  /**
   * 某个宗门当前被封杀的层号列表。
   * 来自服务端 caged_layer_map：长度为 layers → 全局禁闭，否则是若干单层狙击。
   */
  const cagedLayersOf = (cid: number): number[] | null => {
    const map = stats?.caged_layer_map;
    if (!map) return null;
    const entry = map[String(cid)];
    return Array.isArray(entry) ? entry : null;
  };
  const isCaged = (cid: number, flag?: boolean) =>
    cagedLayersOf(cid) !== null || Boolean(stats?.caged_clusters?.includes(cid)) || Boolean(flag);

  const handleToggleCuda = async () => {
    if (!stats) return;
    try {
      await toggleCudaGraph(config, !stats.cuda_graph);
      showToast(t('toast.cudaTo', { v: !stats.cuda_graph ? '⚡ ON' : 'OFF' }));
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    }
  };

  const handleApplyTopK = async () => {
    setIsApplyingTopK(true);
    try {
      await setTopK(config, topKValue, targetScope === 'all' ? null : selectedLayer);
      showToast(
        t('toast.topk', {
          scope: targetScope === 'all' ? t('toast.topkAll', { l: layers }) : t('toast.topkLayer', { l: selectedLayer }),
          k: topKValue,
        }),
      );
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    } finally {
      setIsApplyingTopK(false);
    }
  };

  const handleToggleCage = async (cid: number, currentlyCaged: boolean) => {
    const label = `#${pad2(cid)} ${clusterNames[cid] || ''}`;
    try {
      if (currentlyCaged) {
        await freeCluster(config, cid);
        showToast(t('toast.freed', { label }));
      } else {
        await cageCluster(config, cid);
        showToast(t('toast.caged', { label, l: layers }));
      }
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    }
  };

  /** 单层解封：只恢复被狙击的那一层，其余层保持封杀。 */
  const handleFreeLayer = async (cid: number, layer: number) => {
    const label = `#${pad2(cid)} ${clusterNames[cid] || ''}`;
    try {
      const res = await freeCluster(config, cid, layer);
      const still = res?.still_caged_layers ?? [];
      showToast(
        still.length > 0
          ? t('toast.freeLayerSome', { label, layer: pad2(layer), n: still.length })
          : t('toast.freeLayerAll', { label, layer: pad2(layer) }),
      );
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    }
  };

  const handleSnipe = async () => {
    setIsSniping(true);
    try {
      await snipeCluster(config, snipeLayer, snipeClusterId);
      showToast(
        t('toast.sniped', { layer: pad2(snipeLayer), cid: pad2(snipeClusterId), name: clusterNames[snipeClusterId] || '' }),
      );
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    } finally {
      setIsSniping(false);
    }
  };

  const handleLoadRadar = async () => {
    setIsLoadingRadar(true);
    try {
      setRadarData(await fetchCatchRadar(config));
    } catch (err: any) {
      showToast(describeError(err), 'error');
    } finally {
      setIsLoadingRadar(false);
    }
  };

  const handlePlugCartridge = async () => {
    if (!cartridgeFile && !cartridgePath.trim()) return;
    setIsPlugging(true);
    setUploadPct(cartridgeFile ? 0 : null);
    try {
      // 有本地文件走 multipart 上传，否则用服务端路径
      const res = cartridgeFile
        ? await plugCartridgeWithProgress(config, cartridgeFile, cartridgeSlot, setUploadPct)
        : await plugCartridge(config, null, cartridgePath.trim(), cartridgeSlot);
      const src = cartridgeFile ? t('toast.pluggedUpload') : t('toast.pluggedPath');
      showToast(t('toast.plugged', { n: res.name || cartridgeFile?.name || cartridgePath, src, s: pad2(cartridgeSlot) }));
      setCartridgeFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    } finally {
      setIsPlugging(false);
      setUploadPct(null);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setCartridgeFile(f);
    // 选了文件就自动填上文件名，方便确认
    if (f) setCartridgePath(f.name);
  };

  const handleResetStats = async () => {
    try {
      await resetTelemetryStats(config);
      showToast(t('toast.statsReset'));
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    }
  };

  const artsPct = stats?.arts_core_pct ?? 50.0;
  const sciPct = stats?.sci_core_pct ?? 50.0;
  const vramMb = stats?.vram?.allocated_mb ?? 0;
  const tokSpeed = stats?.metrics?.avg_tokens_per_sec ?? 0;
  const totalTokens = stats?.metrics?.completion_tokens_total ?? 0;
  const slotState = stats?.slot_state ?? 'idle';
  const cudaGraph = stats?.cuda_graph ?? false;
  const maxHits = Math.max(1, ...(stats?.per_cluster?.map(c => c.hits) ?? [1]));

  const plugged = stats?.plugged_cartridges?.[String(cartridgeSlot)];

  const TABS: Array<{ key: 'overview' | 'clusters' | 'topk' | 'radar'; labelKey: ZhKey }> = [
    { key: 'overview', labelKey: 'board.tabOverview' },
    { key: 'clusters', labelKey: 'board.tabClusters' },
    { key: 'topk', labelKey: 'board.tabTopk' },
    { key: 'radar', labelKey: 'board.tabRadar' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#090d16] border-l border-slate-800/80 text-slate-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0b101c]/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wider text-slate-100 flex items-center gap-1.5 font-mono">
              {t('board.title')}{' '}
              <span className="text-cyan-400 text-xs">
                {totalExperts.toLocaleString()}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 font-mono">{t('board.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onRefreshStats}
            disabled={isLoadingStats}
            title={t('board.refreshTitle')}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStats ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          <button
            onClick={handleResetStats}
            disabled={!canWrite}
            title={canWrite ? t('board.resetTitle') : t('board.resetTitleReadonly')}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 模拟数据水印角标 */}
      {isMockMode && (
        <div className="px-3 py-1.5 text-[10px] font-mono bg-amber-950/40 border-b border-amber-800/50 text-amber-300 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" />
          {t('board.mockNote')}
        </div>
      )}

      {/* Toast */}
      {actionNotice && (
        <div
          className={`mx-3 mt-2.5 px-3 py-2 text-xs rounded-md border flex items-start gap-2 ${
            actionNotice.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
              : 'bg-rose-950/40 border-rose-700/60 text-rose-300'
          }`}
        >
          {actionNotice.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span className="font-mono text-[11px] break-words">{actionNotice.msg}</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
        {/* 1. 核心状态 */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">{t('board.vram')}</span>
            <div className="flex items-baseline gap-1">
              <span className="text-base font-bold text-slate-100">{vramMb.toLocaleString()}</span>
              <span className="text-[10px] text-slate-400">MB</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-400 flex justify-between">
              <span>{t('board.vramPeak', { v: stats?.vram?.peak_allocated_mb || 0 })}</span>
              <span>{t('board.vramReserved', { v: stats?.vram?.reserved_mb || 0 })}</span>
            </div>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">{t('board.cudaEngine')}</span>
            <button
              onClick={handleToggleCuda}
              disabled={!canWrite}
              title={canWrite ? undefined : t('board.hotplugReadonly')}
              className={`w-full mt-0.5 py-1 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all ${
                cudaGraph
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700'
              }`}
            >
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                {cudaGraph ? '⚡ ON' : 'OFF'}
              </span>
              <span className="text-[10px] opacity-75">{cudaGraph ? t('board.cudaFast') : 'Eager'}</span>
            </button>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">{t('board.slot')}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${slotState === 'busy' ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className={`font-semibold uppercase text-xs ${slotState === 'busy' ? 'text-amber-300' : 'text-emerald-400'}`}>
                {slotState === 'busy' ? t('board.slotBusy') : t('board.slotIdle')}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block truncate">
              {stats?.slot_holder ? t('board.slotThread', { t: stats.slot_holder }) : t('board.slotQueue')}
            </span>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">{t('board.tokSpeed')}</span>
            <div className="flex items-baseline gap-1">
              <span className="text-base font-bold text-cyan-400">{tokSpeed ? tokSpeed.toFixed(1) : '—'}</span>
              <span className="text-[10px] text-slate-400">tok/s</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">{t('board.tokTotal', { t: totalTokens.toLocaleString() })}</span>
          </div>
        </div>

        {/* 2. 文理双核占比 */}
        <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              {t('board.artsSci')}
            </span>
            <span className="text-[10px] text-slate-400">{t('board.artsSciSub')}</span>
          </div>

          <div className="relative h-4 rounded-md overflow-hidden bg-slate-900 border border-slate-700/60 flex">
            <div style={{ width: `${artsPct}%` }} className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400 transition-all duration-500 flex items-center px-1.5">
              <span className="text-[9px] font-bold text-white drop-shadow-sm truncate">
                {artsPct > 15 ? `${t('board.artsShort')} ${artsPct}%` : ''}
              </span>
            </div>
            <div style={{ width: `${sciPct}%` }} className="h-full bg-gradient-to-r from-orange-500 via-amber-500 to-amber-400 transition-all duration-500 flex items-center px-1.5 justify-end">
              <span className="text-[9px] font-bold text-slate-950 drop-shadow-sm truncate">
                {sciPct > 15 ? `${t('board.sciShort')} ${sciPct}%` : ''}
              </span>
            </div>
          </div>

          <div className="flex justify-between mt-2 text-[10px]">
            <div className="flex items-center gap-1 text-blue-400 font-medium">
              <span className="w-2 h-2 rounded-sm bg-blue-500" />
              {t('board.artsFull')} <span className="text-slate-400">({artsPct}%)</span>
            </div>
            <div className="flex items-center gap-1 text-orange-400 font-medium">
              <span className="w-2 h-2 rounded-sm bg-orange-500" />
              {t('board.sciFull')} <span className="text-slate-400">({sciPct}%)</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#0c121e] border border-slate-800 rounded-lg">
          {TABS.map(({ key, labelKey }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                if (key === 'radar' && !radarData) handleLoadRadar();
              }}
              className={`flex-1 py-1.5 px-2 text-center rounded text-[11px] font-medium transition-colors ${
                activeTab === key
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Tab: 宗门热力 */}
        {activeTab === 'overview' && (
          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-purple-400" />
                {t('board.topTitle')}
              </span>
              <span className="text-[10px] text-slate-400">{t('board.topSub')}</span>
            </div>

            <div className="space-y-2">
              {(stats?.top_clusters || []).map(cluster => {
                const pct = (cluster.hits / maxHits) * 100;
                return (
                  <div key={cluster.id} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 font-bold">#{pad2(cluster.id)}</span>
                        <span className="text-slate-200 font-medium truncate max-w-[130px]">{cluster.name}</span>
                        {cluster.caged && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-rose-950/80 border border-rose-800 text-rose-400">
                            {t('board.cagedBadge')}
                          </span>
                        )}
                        {cluster.slot && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                            {t('board.slotBadge')}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-400">{cluster.hits.toLocaleString()} {t('common.hits_unit')}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className={`h-full rounded transition-all duration-300 ${
                          cluster.caged
                            ? 'bg-rose-600'
                            : cluster.id >= 16
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                              : 'bg-gradient-to-r from-purple-500 via-indigo-400 to-cyan-400'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
              {!stats?.top_clusters?.length && (
                <p className="text-[10px] text-slate-500 py-2">{t('common.noData')}</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-[10px] text-slate-400">
              <span>
                {t('board.clustersTotal', { c: clusters, e: totalExperts.toLocaleString() })}
              </span>
              <button onClick={() => setActiveTab('clusters')} className="text-cyan-400 hover:underline flex items-center gap-0.5">
                {t('board.viewAll', { c: clusters })} <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Tab: 禁闭所 + 单层狙击 */}
        {activeTab === 'clusters' && (
          <div className="space-y-3">
            {/* 单层狙击 */}
            <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-2.5">
              <div>
                <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-rose-400" />
                  {t('board.snipeTitle')}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t('board.snipeDesc', { n: layers - 1 })}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 shrink-0">{t('board.layerLabel')}</span>
                <select
                  value={snipeLayer}
                  onChange={e => setSnipeLayer(Number(e.target.value))}
                  className="bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
                >
                  {Array.from({ length: layers }, (_, i) => (
                    <option key={i} value={i}>
                      Layer {pad2(i)}
                    </option>
                  ))}
                </select>

                <span className="text-[11px] text-slate-400 shrink-0">{t('board.clusterLabel')}</span>
                <select
                  value={snipeClusterId}
                  onChange={e => setSnipeClusterId(Number(e.target.value))}
                  className="bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none flex-1 min-w-0"
                >
                  {clusterNames.slice(0, clusters).map((name, cid) => (
                    <option key={cid} value={cid}>
                      #{pad2(cid)} {name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSnipe}
                disabled={isSniping || !canWrite}
                title={canWrite ? undefined : t('board.snipeReadonly')}
                className="w-full py-1.5 px-3 rounded bg-rose-900/70 hover:bg-rose-800/70 border border-rose-700/60 text-rose-100 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSniping ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('board.sniping')}
                  </>
                ) : (
                  <>
                    <Crosshair className="w-3.5 h-3.5" /> {t('board.doSnipe')}
                  </>
                )}
              </button>

              <p className="text-[9px] text-slate-500 leading-relaxed">
                {t('board.snipeTip')}
              </p>
            </div>

            {/* 在押宗门列表 */}
            <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                  {t('board.cageTitle', { c: clusters })}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t('board.cageDesc', { l: layers })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                {(stats?.per_cluster || []).map(c => {
                  const layers_ = cagedLayersOf(c.id);
                  const caged = isCaged(c.id, c.caged);
                  const isGlobal = layers_ !== null && layers_.length >= layers;
                  const snipedLayers = layers_ !== null && !isGlobal ? layers_ : null;
                  return (
                    <div
                      key={c.id}
                      className={`p-2 rounded border flex items-center justify-between text-[11px] transition-colors ${
                        caged
                          ? 'bg-rose-950/20 border-rose-800/60 text-rose-200'
                          : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-200'
                      }`}
                    >
                      <div className="truncate mr-2 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-bold">#{pad2(c.id)}</span>
                          <span className="font-medium truncate">{c.name}</span>
                        </div>
                        <div className="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5 flex-wrap">
                          <span>{t('board.hitsLabel', { h: c.hits.toLocaleString() })}</span>
                          {c.cartridge && <span className="text-emerald-400 truncate">· 💿{c.cartridge}</span>}
                        </div>
                        {caged && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[9px] text-slate-400">{t('board.cagedLayers')}</span>
                            {isGlobal ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-rose-900/70 border border-rose-700 text-rose-200">
                                {t('board.cagedGlobal', { l: layers })}
                              </span>
                            ) : snipedLayers ? (
                              <>
                                {snipedLayers.map(l => (
                                  <button
                                    key={l}
                                    type="button"
                                    onClick={() => handleFreeLayer(c.id, l)}
                                    disabled={!canWrite}
                                    title={t('board.freeLayerTitle', { l })}
                                    className="text-[9px] px-1 py-0.2 rounded bg-orange-950/70 border border-orange-800 text-orange-200 hover:bg-orange-900 hover:text-orange-100 transition-colors"
                                  >
                                    L{pad2(l)} ✕
                                  </button>
                                ))}
                                <span className="text-[9px] text-orange-300/80">
                                  {t('board.snipeOnly')}
                                </span>
                              </>
                            ) : (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-rose-900/70 border border-rose-700 text-rose-200">
                                {t('board.cagedBadge')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleToggleCage(c.id, caged)}
                        disabled={!canWrite}
                        className={`px-2 py-1 rounded text-[10px] font-medium shrink-0 flex items-center gap-1 transition-colors ${
                          caged
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700 hover:bg-emerald-900'
                            : 'bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900'
                        }`}
                        title={caged ? t('board.releaseAllTitle') : t('board.cageBtnTitle', { l: layers })}
                      >
                        {caged ? (
                          <>
                            <Unlock className="w-2.5 h-2.5" /> {t('board.releaseAll')}
                          </>
                        ) : (
                          <>
                            <Lock className="w-2.5 h-2.5" /> {t('board.cageBtn')}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
                {!stats?.per_cluster?.length && (
                  <p className="text-[10px] text-slate-500 py-2">{t('common.noData')}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab: 弹性开核 */}
        {activeTab === 'topk' && (
          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-3">
            <div>
              <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                {t('board.topkTitle')}
              </span>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {t('board.topkDesc')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">{t('board.scopeLabel')}</span>
              <div className="flex rounded bg-[#111726] border border-slate-800 p-0.5">
                {(
                  [
                    ['all', t('board.scopeAll', { l: layers })],
                    ['layer', t('board.scopeLayer')],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTargetScope(key)}
                    className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      targetScope === key ? 'bg-cyan-900 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {targetScope === 'layer' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 shrink-0">{t('board.pickLayer')}</span>
                <select
                  value={selectedLayer}
                  onChange={e => setSelectedLayer(Number(e.target.value))}
                  className="bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none flex-1"
                >
                  {Array.from({ length: layers }, (_, i) => (
                    <option key={i} value={i}>
                      {t('board.layerOpt', { l: pad2(i), k: stats?.per_layer?.[i]?.top_k ?? '—' })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">{t('board.topkLabel')}</span>
                <span className="text-base font-bold text-cyan-300 font-mono">{t('board.topkUnit', { k: topKValue })}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={topKValue}
                onChange={e => setTopKValue(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span>{t('board.topkMin')}</span>
                <span>{t('board.topkStd')}</span>
                <span>{t('board.topkMax')}</span>
              </div>
            </div>

            <div className="p-2 rounded bg-[#111726] border border-slate-800 text-[10px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>{t('board.perLayerExperts')}</span>
                <span className="text-cyan-400 font-bold">{t('board.expertsUnit', { n: topKValue * expertsPerCluster })}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('board.wholeNet')}</span>
                <span className="text-cyan-400 font-bold">
                  {targetScope === 'all' ? t('board.expertSlots', { n: topKValue * expertsPerCluster * layers }) : t('board.perLayerActive')}
                </span>
              </div>
            </div>

            <button
              onClick={handleApplyTopK}
              disabled={isApplyingTopK || !canWrite}
              className="w-full py-1.5 px-3 rounded bg-cyan-700 hover:bg-cyan-600 text-cyan-100 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {isApplyingTopK ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('board.applying')}
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> {t('board.applyNow')}
                </>
              )}
            </button>
          </div>
        )}

        {/* Tab: 神经雷达 */}
        {activeTab === 'radar' && (
          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <Radar className="w-3.5 h-3.5 text-cyan-400" />
                  {t('board.radarTitle', { l: layers })}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">{t('board.radarDesc')}</p>
              </div>
              <button
                onClick={handleLoadRadar}
                disabled={isLoadingRadar}
                className="p-1 rounded bg-[#111726] border border-slate-800 hover:border-cyan-600 text-slate-300 hover:text-cyan-300"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingRadar ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {((radarData?.layers?.length ? radarData.layers : stats?.per_layer) || []).map((l: any) => {
                // dominant_cluster 为 -1 表示该层尚无前向激活数据
                const domCluster = l.dominant_cluster ?? 0;
                const hasData = l.dominant_cluster != null && l.dominant_cluster >= 0;
                const domName = l.dominant_name || (hasData ? clusterNames[domCluster] : null) || t('board.noActivation');
                const isSuspicious = hasData && domCluster === 16;
                return (
                  <div
                    key={l.layer}
                    className={`flex items-center justify-between p-1.5 rounded border text-[10px] ${
                      isSuspicious
                        ? 'bg-rose-950/30 border-rose-800/80 text-rose-300'
                        : 'bg-[#111726] border-slate-800/70 text-slate-300'
                    }`}
                  >
                    <span className="font-bold text-slate-400">Layer {pad2(l.layer)}</span>
                    <div className="flex items-center gap-1 truncate max-w-[140px]">
                      <span className="text-cyan-400 font-semibold">
                        {hasData ? `#${pad2(domCluster)}` : '--'}
                      </span>
                      <span className="truncate">{domName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">{l.activations || 0} {t('common.hits_unit')}</span>
                      {isSuspicious && (
                        <span className="px-1 py-0.2 rounded bg-rose-900 text-rose-200 text-[9px] font-bold">{t('board.abnormal')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {!radarData?.layers?.length && !stats?.per_layer?.length && (
                <p className="text-[10px] text-slate-500 py-2">{t('common.noData')}</p>
              )}
            </div>
          </div>
        )}

        {/* 卡带热插拔 */}
        <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-2">
          <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
            <Disc className="w-3.5 h-3.5 text-emerald-400" />
            {t('board.cartridgeTitle')}
          </span>
          <p className="text-[10px] text-slate-400">
            {t('board.cartridgeDesc')}
          </p>

          {/* 来源二选一：本地文件上传 / 服务端路径 */}
          <div className="flex rounded bg-[#111726] border border-slate-800 p-0.5">
            {(
              [
                ['upload', t('board.srcUpload')],
                ['path', t('board.srcPath')],
              ] as const
            ).map(([key, label]) => {
              const active = key === 'upload' ? !!cartridgeFile : !cartridgeFile;
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (key === 'upload') fileInputRef.current?.click();
                    else {
                      setCartridgeFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }
                  }}
                  className={`flex-1 py-0.5 px-2 rounded text-[10px] font-medium transition-colors ${
                    active ? 'bg-emerald-900 text-emerald-200' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pt,.pth,.bin,.safetensors"
            onChange={onPickFile}
            className="hidden"
          />

          {cartridgeFile ? (
            <div className="flex items-center gap-2 bg-[#111726] border border-emerald-900/50 rounded px-2 py-1.5">
              <FileUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-200 truncate">{cartridgeFile.name}</p>
                <p className="text-[9px] text-slate-500">{(cartridgeFile.size / 2 ** 20).toFixed(2)} MB</p>
              </div>
              <button
                onClick={() => {
                  setCartridgeFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                title={t('board.cancelPick')}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={cartridgePath}
              onChange={e => setCartridgePath(e.target.value)}
              placeholder={t('board.pathPh')}
              className="w-full bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
            />
          )}

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 shrink-0">{t('board.slotLabel')}</span>
            <select
              value={cartridgeSlot}
              onChange={e => setCartridgeSlot(Number(e.target.value))}
              className="bg-[#111726] border border-slate-800 rounded px-1.5 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none shrink-0"
              title={t('board.slotTarget')}
            >
              {Array.from({ length: clusters }, (_, i) => (
                <option key={i} value={i}>
                  #{pad2(i)}
                </option>
              ))}
            </select>
            <button
              onClick={handlePlugCartridge}
              disabled={isPlugging || !canWrite || (!cartridgeFile && !cartridgePath.trim())}
              title={canWrite ? undefined : t('board.hotplugReadonly')}
              className="flex-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-emerald-100 font-medium text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {isPlugging ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  {uploadPct != null ? t('board.uploading', { p: uploadPct }) : t('board.implanting')}
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  {t('board.hotplug')}
                </>
              )}
            </button>
          </div>

          {uploadPct != null && isPlugging && (
            <div className="h-1 w-full bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          )}

          {plugged ? (
            <div className="text-[10px] text-emerald-400/90 bg-emerald-950/30 p-1.5 rounded border border-emerald-900/50 flex justify-between gap-2">
              <span className="truncate">
                #{pad2(cartridgeSlot)} {t('board.mounted', { n: plugged.name })}
              </span>
              <span className="shrink-0">{plugged.plugged_ms ?? 0}ms</span>
            </div>
          ) : (
            <p className="text-[10px] text-slate-500">{t('board.slotEmpty', { s: pad2(cartridgeSlot) })}</p>
          )}
        </div>
      </div>
    </div>
  );
};
