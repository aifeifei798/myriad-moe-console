import React, { useState, useEffect } from 'react';
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
} from '../services/myriadApi';
import { MyriadApiError } from '../services/apiError';
import { useClusterNames, useModelShape } from '../services/mockEngine';

interface NeuralDashboardProps {
  stats: TelemetryStats | null;
  config: ClientConfig;
  onRefreshStats: () => void;
  isLoadingStats?: boolean;
  isMockMode?: boolean;
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

export const NeuralDashboard: React.FC<NeuralDashboardProps> = ({
  stats,
  config,
  onRefreshStats,
  isLoadingStats = false,
  isMockMode = false,
}) => {
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
    err instanceof MyriadApiError ? err.describe(config.baseUrl) : err?.message || '操作失败';

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
      showToast(`CUDA Graph 已切换为: ${!stats.cuda_graph ? '⚡ ON' : 'OFF'}`);
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
        `开核调频生效: ${targetScope === 'all' ? `全局 ${layers} 层统一` : `第 ${selectedLayer} 层`} 设置为 ${topKValue} 核`,
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
        showToast(`🔓 宗门 ${label} 已刑满释放（其所有被封杀层均已恢复）`);
      } else {
        await cageCluster(config, cid);
        showToast(`🔒 宗门 ${label} 已关押，全 ${layers} 层路由打入冷宫`);
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
          ? `🔓 ${label} 第 ${pad2(layer)} 层已解封，仍有 ${still.length} 层处于封杀`
          : `🔓 ${label} 第 ${pad2(layer)} 层已解封，该宗门已全部释放`,
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
        `🎯 Layer ${pad2(snipeLayer)} · #${pad2(snipeClusterId)} ${clusterNames[snipeClusterId] || ''} 已置零并封杀本层路由（注意：/free 会释放其全部层）`,
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
    if (!cartridgePath.trim()) return;
    setIsPlugging(true);
    try {
      const res = await plugCartridge(config, null, cartridgePath.trim(), cartridgeSlot);
      showToast(`⚡ 卡带《${res.name || cartridgePath}》植入插槽 #${pad2(cartridgeSlot)} 成功`);
      onRefreshStats();
    } catch (err: any) {
      showToast(describeError(err), 'error');
    } finally {
      setIsPlugging(false);
    }
  };

  const handleResetStats = async () => {
    try {
      await resetTelemetryStats(config);
      showToast('🧹 全息遥测统计已清零');
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
              MYRIAD-MoE{' '}
              <span className="text-cyan-400 text-xs">
                {totalExperts.toLocaleString()}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 font-mono">全息神经透视监控看板</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onRefreshStats}
            disabled={isLoadingStats}
            title="刷新看板数据"
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStats ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          <button
            onClick={handleResetStats}
            title="清零统计指标"
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
          以下数值为本地模拟，非真实遥测
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
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">显存已分配</span>
            <div className="flex items-baseline gap-1">
              <span className="text-base font-bold text-slate-100">{vramMb.toLocaleString()}</span>
              <span className="text-[10px] text-slate-400">MB</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-400 flex justify-between">
              <span>峰值 {stats?.vram?.peak_allocated_mb || 0}M</span>
              <span>保留 {stats?.vram?.reserved_mb || 0}M</span>
            </div>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">CUDA GRAPH 引擎</span>
            <button
              onClick={handleToggleCuda}
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
              <span className="text-[10px] opacity-75">{cudaGraph ? '极速' : 'Eager'}</span>
            </button>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">推理槽位</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${slotState === 'busy' ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className={`font-semibold uppercase text-xs ${slotState === 'busy' ? 'text-amber-300' : 'text-emerald-400'}`}>
                {slotState === 'busy' ? 'BUSY (推流中)' : 'IDLE (空闲)'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block truncate">
              {stats?.slot_holder ? `线程: ${stats.slot_holder}` : '单槽排队保障'}
            </span>
          </div>

          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">平均吐字速率</span>
            <div className="flex items-baseline gap-1">
              <span className="text-base font-bold text-cyan-400">{tokSpeed ? tokSpeed.toFixed(1) : '—'}</span>
              <span className="text-[10px] text-slate-400">tok/s</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">累计 {totalTokens.toLocaleString()} tokens</span>
          </div>
        </div>

        {/* 2. 文理双核占比 */}
        <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              文理双大核实时占比
            </span>
            <span className="text-[10px] text-slate-400">双核协同动态路由</span>
          </div>

          <div className="relative h-4 rounded-md overflow-hidden bg-slate-900 border border-slate-700/60 flex">
            <div style={{ width: `${artsPct}%` }} className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400 transition-all duration-500 flex items-center px-1.5">
              <span className="text-[9px] font-bold text-white drop-shadow-sm truncate">
                {artsPct > 15 ? `文科 ${artsPct}%` : ''}
              </span>
            </div>
            <div style={{ width: `${sciPct}%` }} className="h-full bg-gradient-to-r from-orange-500 via-amber-500 to-amber-400 transition-all duration-500 flex items-center px-1.5 justify-end">
              <span className="text-[9px] font-bold text-slate-950 drop-shadow-sm truncate">
                {sciPct > 15 ? `理科 ${sciPct}%` : ''}
              </span>
            </div>
          </div>

          <div className="flex justify-between mt-2 text-[10px]">
            <div className="flex items-center gap-1 text-blue-400 font-medium">
              <span className="w-2 h-2 rounded-sm bg-blue-500" />
              文科常识基盘 (Arts) <span className="text-slate-400">({artsPct}%)</span>
            </div>
            <div className="flex items-center gap-1 text-orange-400 font-medium">
              <span className="w-2 h-2 rounded-sm bg-orange-500" />
              理科宏核 (Sci) <span className="text-slate-400">({sciPct}%)</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#0c121e] border border-slate-800 rounded-lg">
          {(
            [
              ['overview', '宗门热力'],
              ['clusters', '禁闭所'],
              ['topk', '弹性开核'],
              ['radar', '神经雷达'],
            ] as const
          ).map(([key, label]) => (
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
              {label}
            </button>
          ))}
        </div>

        {/* Tab: 宗门热力 */}
        {activeTab === 'overview' && (
          <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-purple-400" />
                宗门活跃热力排行 (Top 6)
              </span>
              <span className="text-[10px] text-slate-400">微专家集群命中率</span>
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
                            🔒 禁闭
                          </span>
                        )}
                        {cluster.slot && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                            💿 插槽
                          </span>
                        )}
                      </div>
                      <span className="text-slate-400">{cluster.hits.toLocaleString()} 拍</span>
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
                <p className="text-[10px] text-slate-500 py-2">暂无数据。请确认服务已启动并完成模型加载。</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-[10px] text-slate-400">
              <span>
                共 {clusters} 宗门 · {totalExperts.toLocaleString()} 微专家
              </span>
              <button onClick={() => setActiveTab('clusters')} className="text-cyan-400 hover:underline flex items-center gap-0.5">
                查看全部 {clusters} 宗门 <ChevronRight className="w-3 h-3" />
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
                  单层狙击 (在第 N 层额外关押宗门 M)
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  原地置零该层的 LoRA B 偏置并把本层路由打入冷宫，其余 {layers - 1} 层不受影响
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 shrink-0">层号</span>
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

                <span className="text-[11px] text-slate-400 shrink-0">宗门</span>
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
                disabled={isSniping}
                className="w-full py-1.5 px-3 rounded bg-rose-900/70 hover:bg-rose-800/70 border border-rose-700/60 text-rose-100 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSniping ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 狙击中...
                  </>
                ) : (
                  <>
                    <Crosshair className="w-3.5 h-3.5" /> 执行狙击
                  </>
                )}
              </button>

              <p className="text-[9px] text-slate-500 leading-relaxed">
                禁闭所列表里每个 <code className="text-slate-400">L07 ✕</code>{' '}
                按钮可单独解封某一层；「释放全部」则会恢复该宗门的所有被封杀层。
              </p>
            </div>

            {/* 在押宗门列表 */}
            <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                  {clusters} 宗门禁闭管理所
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  全局禁闭会清零该宗门在所有 {layers} 层的权重并封杀其路由
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
                          <span>命中 {c.hits.toLocaleString()}</span>
                          {c.cartridge && <span className="text-emerald-400 truncate">· 💿{c.cartridge}</span>}
                        </div>
                        {caged && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[9px] text-slate-400">封杀层</span>
                            {isGlobal ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-rose-900/70 border border-rose-700 text-rose-200">
                                🔒 全局 · 全部 {layers} 层
                              </span>
                            ) : snipedLayers ? (
                              <>
                                {snipedLayers.map(l => (
                                  <button
                                    key={l}
                                    type="button"
                                    onClick={() => handleFreeLayer(c.id, l)}
                                    title={`点击仅解封第 ${l} 层（其余层保持封杀）`}
                                    className="text-[9px] px-1 py-0.2 rounded bg-orange-950/70 border border-orange-800 text-orange-200 hover:bg-orange-900 hover:text-orange-100 transition-colors"
                                  >
                                    L{pad2(l)} ✕
                                  </button>
                                ))}
                                <span className="text-[9px] text-orange-300/80">
                                  🎯 单点解封
                                </span>
                              </>
                            ) : (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-rose-900/70 border border-rose-700 text-rose-200">
                                🔒 已禁闭
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleToggleCage(c.id, caged)}
                        className={`px-2 py-1 rounded text-[10px] font-medium shrink-0 flex items-center gap-1 transition-colors ${
                          caged
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700 hover:bg-emerald-900'
                            : 'bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900'
                        }`}
                        title={caged ? '释放该宗门的全部被封杀层' : `在全部 ${layers} 层关禁闭`}
                      >
                        {caged ? (
                          <>
                            <Unlock className="w-2.5 h-2.5" /> 释放全部
                          </>
                        ) : (
                          <>
                            <Lock className="w-2.5 h-2.5" /> 关禁闭
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
                {!stats?.per_cluster?.length && (
                  <p className="text-[10px] text-slate-500 py-2">暂无数据。请确认服务已启动并完成模型加载。</p>
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
                弹性开核调度台
              </span>
              <p className="text-[10px] text-slate-400 mt-0.5">
                实时调节异构金字塔每步激活的宗门小核数 (Top-K，1~10 核)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">调节范围:</span>
              <div className="flex rounded bg-[#111726] border border-slate-800 p-0.5">
                {(
                  [
                    ['all', `全局 ${layers} 层统一`],
                    ['layer', '单层精细调频'],
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
                <span className="text-[11px] text-slate-400 shrink-0">选择层号:</span>
                <select
                  value={selectedLayer}
                  onChange={e => setSelectedLayer(Number(e.target.value))}
                  className="bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none flex-1"
                >
                  {Array.from({ length: layers }, (_, i) => (
                    <option key={i} value={i}>
                      Layer {pad2(i)} (当前: {stats?.per_layer?.[i]?.top_k ?? '—'} 核)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">小核并发数 (Top-K):</span>
                <span className="text-base font-bold text-cyan-300 font-mono">{topKValue} 核</span>
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
                <span>1 (极限省算力)</span>
                <span>4 (标准)</span>
                <span>10 (全开)</span>
              </div>
            </div>

            <div className="p-2 rounded bg-[#111726] border border-slate-800 text-[10px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>单层微专家并发:</span>
                <span className="text-cyan-400 font-bold">{topKValue * expertsPerCluster} 微专家</span>
              </div>
              <div className="flex justify-between">
                <span>全网络推理并发:</span>
                <span className="text-cyan-400 font-bold">
                  {targetScope === 'all' ? `${topKValue * expertsPerCluster * layers} 专家槽位` : '分层配置生效'}
                </span>
              </div>
            </div>

            <button
              onClick={handleApplyTopK}
              disabled={isApplyingTopK}
              className="w-full py-1.5 px-3 rounded bg-cyan-700 hover:bg-cyan-600 text-cyan-100 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {isApplyingTopK ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 调频中...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> 即时应用调频
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
                  {layers} 层逐层主导宗门雷达
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">实时扫描各层前向激活权重最大的宗门与异常波动</p>
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
                const domName = l.dominant_name || (hasData ? clusterNames[domCluster] : null) || '暂无激活数据';
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
                      <span className="text-slate-400">{l.activations || 0} 拍</span>
                      {isSuspicious && (
                        <span className="px-1 py-0.2 rounded bg-rose-900 text-rose-200 text-[9px] font-bold">🔥异常</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {!radarData?.layers?.length && !stats?.per_layer?.length && (
                <p className="text-[10px] text-slate-500 py-2">暂无数据。</p>
              )}
            </div>
          </div>
        )}

        {/* 卡带热插拔 */}
        <div className="bg-[#0e1424] border border-slate-800 rounded-lg p-3 space-y-2">
          <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
            <Disc className="w-3.5 h-3.5 text-emerald-400" />
            特区插槽卡带热插拔
          </span>
          <p className="text-[10px] text-slate-400">
            原地写插槽权重，无需重启，CUDA Graph 保持常驻。路径相对于服务端进程的工作目录。
          </p>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={cartridgePath}
              onChange={e => setCartridgePath(e.target.value)}
              placeholder="卡带文件名 (如 cartridge_gongfang.pt)"
              className="flex-1 bg-[#111726] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none min-w-0"
            />
            <select
              value={cartridgeSlot}
              onChange={e => setCartridgeSlot(Number(e.target.value))}
              className="bg-[#111726] border border-slate-800 rounded px-1.5 py-1 text-slate-200 text-xs focus:border-cyan-500 focus:outline-none shrink-0"
              title="目标插槽"
            >
              {Array.from({ length: clusters }, (_, i) => (
                <option key={i} value={i}>
                  #{pad2(i)}
                </option>
              ))}
            </select>
            <button
              onClick={handlePlugCartridge}
              disabled={isPlugging || !cartridgePath.trim()}
              className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-emerald-100 font-medium text-xs transition-colors shrink-0 flex items-center gap-1 disabled:opacity-50"
            >
              <Zap className="w-3 h-3" />
              热插拔
            </button>
          </div>

          {plugged ? (
            <div className="text-[10px] text-emerald-400/90 bg-emerald-950/30 p-1.5 rounded border border-emerald-900/50 flex justify-between gap-2">
              <span className="truncate">
                #{pad2(cartridgeSlot)} 已挂载: {plugged.name}
              </span>
              <span className="shrink-0">{plugged.plugged_ms ?? 0}ms</span>
            </div>
          ) : (
            <p className="text-[10px] text-slate-500">插槽 #{pad2(cartridgeSlot)} 当前为空</p>
          )}
        </div>
      </div>
    </div>
  );
};