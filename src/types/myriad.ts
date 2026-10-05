export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning_content?: string;
  isStreaming?: boolean;
  thinkingTime?: number; // seconds
  createdAt: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  metrics?: {
    elapsed_sec?: number;
    tokens_per_sec?: number;
    ttft_sec?: number;
  };
  isCommand?: boolean;
  /**
   * true = 这条消息是本地报错提示或指令回显，不应作为上下文回传给模型。
   * 之前错误提示和 /stats 表格输出都会被当成 assistant 消息发回去，污染后续对话。
   */
  excludeFromContext?: boolean;
  /** 本次问答专属的全息遥测，由服务端在流式末尾随 myriad 字段下发。 */
  telemetry?: {
    arts_core_pct?: number;
    sci_core_pct?: number;
    cuda_graph?: boolean;
    slot_state?: string;
    top_clusters?: Array<{ id: number; name: string; hits: number; slot?: boolean; caged?: boolean }>;
  };
}

export interface ClusterInfo {
  id: number;
  name: string;
  hits: number;
  caged: boolean;
  cartridge?: string | null;
  slot?: boolean;
}

export interface LayerInfo {
  layer: number;
  top_k: number;
  active_experts: number;
  dominant_cluster?: number;
  dominant_name?: string | null;
  activations?: number;
}

export interface TelemetryStats {
  model: string;
  base_model?: string;
  layers: number;
  clusters: number;
  experts_per_cluster: number;
  total_experts: number;
  arts_core_pct: number;
  sci_core_pct: number;
  cuda_graph: boolean;
  cache_bucket_tokens?: number;
  slot_state: 'idle' | 'busy';
  slot_holder?: string | null;
  caged_clusters: number[];
  /**
   * 宗门号 → 实际被封杀的层号列表。
   * 长度 === layers 说明是全局禁闭 (cage)；否则是单层狙击 (snipe) 的结果。
   * 服务端 free(cid) 总是整宗释放，所以释放后该键会整体消失。
   */
  caged_layer_map?: Record<string, number[]>;
  plugged_cartridges?: Record<string, {
    name: string;
    source?: string;
    plugged_ms?: number;
    at?: string;
  }>;
  vram: {
    allocated_mb?: number;
    peak_allocated_mb?: number;
    reserved_mb?: number;
  };
  metrics: {
    uptime_sec?: number;
    requests_total: number;
    errors_total?: number;
    stream_requests?: number;
    command_requests?: number;
    active_requests?: number;
    waiting_requests?: number;
    avg_ttft_sec?: number | null;
    p95_ttft_sec?: number | null;
    avg_duration_sec?: number | null;
    avg_tokens_per_sec?: number | null;
    prompt_tokens_total?: number;
    completion_tokens_total: number;
    prompt_tok_per_sec?: number;
  };
  top_clusters: Array<{
    id: number;
    name: string;
    hits: number;
    slot?: boolean;
    caged?: boolean;
  }>;
  per_cluster: ClusterInfo[];
  per_layer: LayerInfo[];
}

export interface CatchRadarLayer {
  layer: number;
  dominant_cluster: number | null;
  dominant_name?: string | null;
  activations: number;
  suspicious?: boolean;
}

export interface CatchRadarResponse {
  object: string;
  layers: CatchRadarLayer[];
  top_clusters: Array<{
    id: number;
    name: string;
    hits: number;
    slot?: boolean;
    caged?: boolean;
  }>;
}

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 始终置于上下文首条；留空则不发送 system 消息。 */
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  repetitionPenalty: number;
  splitReasoning: boolean;
  mockFallback: boolean;
  pollIntervalMs: number;
  /** 上下文保留轮数（4~30），超出部分的历史会被裁掉以控制 prompt 长度。 */
  contextRounds: number;
  focusClusters: number[];
  topKOverride: number | null;
}
