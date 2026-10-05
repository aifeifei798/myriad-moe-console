import { TelemetryStats, CatchRadarResponse } from '../types/myriad';

/**
 * 离线演示用的宗门名。
 *
 * 仅在**无法连接服务端**时才会被使用。真实运行时，宗门名一律以
 * /v1/myriad/stats 返回的 per_cluster[].name 为准 —— 服务端的
 * --num-clusters / CLUSTER_NAMES 是可配的，前端硬编码会操作到错误的宗门。
 */
export const FALLBACK_CLUSTER_NAMES: string[] = [
  'Code_Algo',
  'Math_Formula',
  'Sci_Physics',
  'Sci_Chemistry',
  'Sci_Astronomy',
  'Sci_Biology',
  'Logic_Proof',
  'NLP_Lexicon',
  'History_Civ',
  'Arts_Philosophy',
  'Law_Juris',
  'Finance_Econ',
  'Medical_Health',
  'Geo_Climate',
  'Social_System',
  'Creative_Write',
  'Custom_Rules',
  'Exp_Domain_17',
  'Exp_Domain_18',
  'Exp_Domain_19',
];

/**
 * 兼容旧引用。优先从实时 stats 读取，读取不到才回退到这里。
 * 见 useClusterNames()。
 */
export const CLUSTER_NAMES = FALLBACK_CLUSTER_NAMES;

/**
 * 从遥测数据里取宗门名列表。真实在线时这是唯一权威来源。
 * 若 stats 缺失（例如断线瞬间），退回内置的演示用名称。
 */
export function useClusterNames(stats: TelemetryStats | null | undefined): string[] {
  if (stats?.per_cluster?.length) {
    return stats.per_cluster.map((c) => c.name || `Cluster_${c.id}`);
  }
  return FALLBACK_CLUSTER_NAMES;
}

/** 从遥测数据里读取模型规模，读不到时给出保守的默认值。 */
export function useModelShape(stats: TelemetryStats | null | undefined) {
  return {
    layers: stats?.layers ?? 28,
    clusters: stats?.clusters ?? 20,
    expertsPerCluster: stats?.experts_per_cluster ?? 45,
    totalExperts: stats?.total_experts ?? 25200,
  };
}

class MockMyriadState {
  artsCorePct = 68.4;
  cudaGraph = true;
  slotState: 'idle' | 'busy' = 'idle';
  vramAllocated = 4218.4;
  requestsTotal = 142;
  completionTokensTotal = 18450;
  avgTokensPerSec = 118.5;
  cagedClusters = new Set<number>();
  /**
   * 宗门号 → 被封杀的层号列表，与服务端 caged_layer_map 语义保持一致，
   * 这样离线演示时禁闭所面板的渲染逻辑和真实模式完全相同。
   */
  cagedLayerMap = new Map<number, number[]>();
  pluggedCartridges: Record<string, { name: string; source?: string; plugged_ms?: number; at?: string }> = {
    '16': {
      name: 'cartridge_gongfang.pt',
      source: 'cartridge_gongfang.pt',
      plugged_ms: 12.4,
      at: '2026-10-05 16:30:12',
    },
  };
  clusterHits: number[] = [
    12840, 9420, 8150, 6200, 5400, 4890, 7120, 11450, 4120, 5320,
    3180, 4290, 3940, 2810, 3420, 8940, 450, 120, 95, 60,
  ];
  layerTopK: number[] = [
    1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 3, 3, 3, 3, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1,
  ];

  private numLayers(): number {
    return this.layerTopK.length;
  }

  private numClusters(): number {
    return this.clusterHits.length;
  }

  private expertsPerCluster(): number {
    return 45;
  }

  private cageAllLayers(cid: number): void {
    const all = Array.from({ length: this.numLayers() }, (_, i) => i);
    this.cagedLayerMap.set(cid, all);
    this.cagedClusters.add(cid);
  }

  getStats(): TelemetryStats {
    const layers = this.numLayers();
    const clusters = this.numClusters();
    const experts = this.expertsPerCluster();
    const names = FALLBACK_CLUSTER_NAMES;

    const noise = (Math.random() - 0.5) * 1.2;
    const arts = Number(
      Math.min(95, Math.max(5, this.artsCorePct + noise)).toFixed(1),
    );

    const perCluster = Array.from({ length: clusters }, (_, id) => ({
      id,
      name: names[id] || `Cluster_${id}`,
      hits: this.clusterHits[id] ?? 0,
      caged: this.cagedClusters.has(id),
      cartridge: this.pluggedCartridges[String(id)]?.name || null,
      slot: id >= 16,
    }));

    const topClusters = [...perCluster]
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 6)
      .map(c => ({ id: c.id, name: c.name, hits: c.hits, slot: c.slot, caged: c.caged }));

    const perLayer = this.layerTopK.map((k, layer) => {
      const dom = (layer * 3 + 2) % clusters;
      return {
        layer,
        top_k: k,
        active_experts: k * experts,
        dominant_cluster: dom,
        dominant_name: names[dom] || `Cluster_${dom}`,
        activations: Math.floor(80 + Math.random() * 120),
      };
    });

    const cagedLayerMap: Record<string, number[]> = {};
    this.cagedLayerMap.forEach((v, k) => {
      cagedLayerMap[String(k)] = v;
    });

    return {
      model: 'myriad-moe-25k-lora',
      base_model: 'Qwen/Qwen3-0.6B',
      layers,
      clusters,
      experts_per_cluster: experts,
      total_experts: layers * clusters * experts,
      arts_core_pct: arts,
      sci_core_pct: Number((100 - arts).toFixed(1)),
      cuda_graph: this.cudaGraph,
      slot_state: this.slotState,
      slot_holder: this.slotState === 'busy' ? 'chatcmpl-mock' : null,
      caged_clusters: Array.from(this.cagedClusters).sort((a, b) => a - b),
      caged_layer_map: cagedLayerMap,
      plugged_cartridges: this.pluggedCartridges,
      vram: {
        allocated_mb: Number((this.vramAllocated + (Math.random() * 8 - 4)).toFixed(1)),
        peak_allocated_mb: 5120.0,
        reserved_mb: 6144.0,
      },
      metrics: {
        uptime_sec: 14200,
        requests_total: this.requestsTotal,
        errors_total: 0,
        stream_requests: this.requestsTotal - 12,
        command_requests: 12,
        active_requests: this.slotState === 'busy' ? 1 : 0,
        waiting_requests: 0,
        avg_ttft_sec: 0.082,
        p95_ttft_sec: 0.145,
        avg_duration_sec: 1.45,
        avg_tokens_per_sec: Number((this.avgTokensPerSec + (Math.random() * 4 - 2)).toFixed(1)),
        prompt_tokens_total: 42100,
        completion_tokens_total: this.completionTokensTotal,
        prompt_tok_per_sec: 342.1,
      },
      top_clusters: topClusters,
      per_cluster: perCluster,
      per_layer: perLayer,
    };
  }

  getCatchRadar(): CatchRadarResponse {
    const stats = this.getStats();
    return {
      object: 'myriad.catch',
      layers: stats.per_layer.map(l => ({
        layer: l.layer,
        dominant_cluster: l.dominant_cluster ?? null,
        dominant_name: l.dominant_name ?? null,
        activations: l.activations ?? 0,
        suspicious: l.dominant_cluster === 16,
      })),
      top_clusters: stats.top_clusters,
    };
  }

  setTopK(k: number, layer: number | null) {
    const safeK = Math.max(1, Math.min(10, k));
    if (layer === null) {
      this.layerTopK = this.layerTopK.map(() => safeK);
      return {
        scope: 'all',
        k: safeK,
        active_experts_per_step: safeK * this.expertsPerCluster() * this.numLayers(),
      };
    }
    if (layer >= 0 && layer < this.numLayers()) {
      this.layerTopK[layer] = safeK;
      return { scope: 'layer', layer, k: safeK, active_experts: safeK * this.expertsPerCluster() };
    }
    throw new Error(`层号需在 0 ~ ${this.numLayers() - 1} 之间`);
  }

  cage(cid: number) {
    if (cid < 0 || cid >= this.numClusters()) {
      throw new Error(`宗门编号需在 0 ~ ${this.numClusters() - 1} 之间`);
    }
    if (this.cagedClusters.has(cid)) throw new Error(`宗门 #${String(cid).padStart(2, '0')} 已在禁闭室`);
    this.cageAllLayers(cid);
    return { cluster: cid, name: FALLBACK_CLUSTER_NAMES[cid], caged_layers: this.numLayers() };
  }

  free(cid: number, layer: number | null = null) {
    if (cid < 0 || cid >= this.numClusters()) {
      throw new Error(`宗门编号需在 0 ~ ${this.numClusters() - 1} 之间`);
    }
    if (!this.cagedClusters.has(cid)) {
      throw new Error(`宗门 #${String(cid).padStart(2, '0')} 并未被关押`);
    }
    const name = FALLBACK_CLUSTER_NAMES[cid];

    if (layer === null) {
      const released = [...(this.cagedLayerMap.get(cid) ?? [])];
      this.cagedClusters.delete(cid);
      this.cagedLayerMap.delete(cid);
      return { cluster: cid, name, released_layers: released, fully_released: true, still_caged_layers: [] };
    }

    // 单层解封，语义与服务端 free(cid, layer) 保持一致
    const cur = this.cagedLayerMap.get(cid) ?? [];
    if (!cur.includes(layer)) {
      throw new Error(`宗门 #${String(cid).padStart(2, '0')} 在第 ${layer} 层并未被封杀`);
    }
    const remaining = cur.filter(l => l !== layer);
    const fullyReleased = remaining.length === 0;
    if (fullyReleased) {
      this.cagedClusters.delete(cid);
      this.cagedLayerMap.delete(cid);
    } else {
      this.cagedLayerMap.set(cid, remaining);
    }
    return {
      cluster: cid,
      name,
      released_layers: [layer],
      fully_released: fullyReleased,
      still_caged_layers: remaining,
    };
  }

  snipe(layer: number, cid: number) {
    if (layer < 0 || layer >= this.numLayers()) {
      throw new Error(`层号需在 0 ~ ${this.numLayers() - 1} 之间`);
    }
    if (cid < 0 || cid >= this.numClusters()) {
      throw new Error(`宗门编号需在 0 ~ ${this.numClusters() - 1} 之间`);
    }
    const cur = this.cagedLayerMap.get(cid) || [];
    if (!cur.includes(layer)) cur.push(layer);
    cur.sort((a, b) => a - b);
    this.cagedLayerMap.set(cid, cur);
    this.cagedClusters.add(cid);
    return { layer, cluster: cid, name: FALLBACK_CLUSTER_NAMES[cid] };
  }

  setEngine(cudaGraph?: boolean) {
    if (cudaGraph !== undefined) this.cudaGraph = cudaGraph;
    return { cuda_graph: this.cudaGraph, max_len: 512 };
  }

  resetStats() {
    this.clusterHits = this.clusterHits.map(() => 0);
    this.requestsTotal = 0;
    this.completionTokensTotal = 0;
    return { object: 'myriad.stats.reset', ok: true, message: '🧹 统计已清零' };
  }

  plugCartridge(name: string, slot: number) {
    this.pluggedCartridges[String(slot)] = {
      name,
      source: name,
      plugged_ms: 14.8,
      at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    // 与服务端一致：插卡带会把该插槽从禁闭名单里摘出来
    this.cagedClusters.delete(slot);
    this.cagedLayerMap.delete(slot);
    return { slot, name, elapsed_ms: 14.8 };
  }

  recordGeneration(promptTokens: number, completionTokens: number) {
    this.requestsTotal += 1;
    this.completionTokensTotal += completionTokens;
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * this.numClusters());
      if (!this.cagedClusters.has(idx)) {
        this.clusterHits[idx] += Math.floor(Math.random() * 15 + 5);
      }
    }
  }
}

export const mockState = new MockMyriadState();