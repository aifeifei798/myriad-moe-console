import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'myriad_lang';

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {}
  // 浏览器首选英文则默认英文，否则默认中文
  try {
    const nav = navigator.language?.toLowerCase() || '';
    if (nav.startsWith('en')) return 'en';
  } catch {}
  return 'zh';
}

/** 以中文为源，英文逐键对照。新增 UI 文案时两边都要加。 */
const zh = {
  // —— 通用 ——
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.copy': '复制',
  'common.copyContent': '复制内容',
  'common.copyMessage': '复制消息',
  'common.openConfig': '打开配置',
  'common.switchKey': '切换 Key',
  'common.noData': '暂无数据。请确认服务已启动并完成模型加载。',
  'common.hits_unit': '拍',

  // —— 顶栏 / 状态 ——
  'header.title': 'Myriad-MoE 交互工作台',
  'header.subtitle': '模型: {model} · 双大核协同 · 25,200 微专家',
  'header.resetSession': '重置会话',
  'header.resetSessionTitle': '清空对话记忆',
  'header.configCenter': '配置中心',
  'header.configCenterTitle': '配置 Base URL 与推理参数',
  'header.collapseBoard': '收起看板',
  'header.expandBoard': '全息监控台',
  'header.toggleBoardTitle': '展开/折叠神经透视监控看板',
  'header.readonly': '只读',
  'header.readonlyTitle': '当前令牌仅可读取遥测，写操作会被服务端拒绝 (403)',
  'header.noAuth': '未鉴权',
  'header.noAuthTitle': '服务端未设置 --api-key / --read-only-key，任何人都可操作',
  'status.online': '服务在线',
  'status.mock': '模拟演示中',
  'status.offline': '服务离线',
  'status.loading': '模型加载中',

  // —— 横幅 ——
  'banner.readonlyTitle': '只读模式',
  'banner.readonlyBody': '可查看看板遥测，但无法生成回答或执行宗门禁闭 / 狙击 / 调频 / 热插拔。需要这些能力请在「配置中心」改用管理员 API Key。',
  'banner.mockTitle': '当前为本地模拟数据',
  'banner.mockBody': '并非真实模型输出',
  'banner.mockReason': '原因：',
  'banner.loadingTitle': '推理服务已启动，模型权重仍在加载',
  'banner.loadingBody': '加载完成后即可对话，看板会自动开始刷新',
  'banner.offlineTitle': '推理服务未连接',

  // —— 空态 ——
  'empty.title': 'Myriad-MoE 神经全息客户端',
  'empty.desc': '已对接本地私有化部署的 25,200 微专家大模型服务。支持全息神经透视、思维链折叠推演、逐层开核与宗门实时禁闭。',
  'empty.card1Title': '文理双核算力测试',
  'empty.card1Desc': '评估文科常识基盘与理科宏核的动态算力分配与数学推导',
  'empty.card1Prompt': '测试文理双核算力协同，推导快速排序并给出复杂度评估',
  'empty.card2Title': '执行 /catch 神经雷达扫描',
  'empty.card2Desc': '检测 28 层网络中各层激活拍数与主导宗门，排查异常波动',
  'empty.card3Title': '查看全息看板 (/stats)',
  'empty.card3Desc': '获取当前文理占比、Top 宗门活跃排行及 CUDA Graph 状态',
  'empty.card4Title': '检查 20 宗门状态 (/clusters)',
  'empty.card4Desc': '查看各宗门总命中数、禁闭所关押状态及特区卡带挂载',

  // —— 消息 ——
  'msg.commandBadge': '⚡ 指令响应',
  'msg.localBadge': '本地提示',
  'msg.localBadgeTitle': '本地提示，不会作为上下文回传给模型',
  'msg.streaming': '正在调度神经微专家生成解答...',
  'msg.regenerate': '重新生成',
  'msg.ttftTitle': '首字延迟',

  // —— 遥测条 ——
  'telemetry.thisRoute': '本次路由',
  'telemetry.arts': '文',
  'telemetry.sci': '理',
  'telemetry.leading': '主导',

  // —— 斜杠指令 ——
  'slash.title': 'Myriad-MoE 原生斜杠指令',
  'slash.hint': '点击填入输入框',
  'slash.catch': '扫描 28 层逐层主导宗门雷达',
  'slash.stats': '获取文理双核与全息遥测看板',
  'slash.clusters': '列出 20 宗门命中与禁闭状态',
  'slash.show_k': '显示各层开核数与并发配置',
  'slash.set_k': '单层开核数调频',
  'slash.set_k_all': '全局 28 层统一开核数调频',
  'slash.cage': '全局禁闭某宗门 (如 /cage 16)',
  'slash.free': '释放某宗门 (会恢复其所有被封杀层)',
  'slash.snipe': '单层狙击 (如 /snipe 21 16)',
  'slash.graph': '切换 CUDA Graph 极速引擎',
  'slash.clear': '清空本地上下文',
  'slash.help': '查看全部 Myriad 命令指南',

  // —— 输入区 ——
  'input.placeholder': '发送消息，或输入 / 调用神经透视指令（如 /catch、/stats、/show_k）...',
  'input.commandsTitle': '常用指令列表',
  'input.interrupt': '打断',
  'input.hint': 'Enter 提交 · Shift + Enter 换行 · 输入 / 唤出指令',
  'input.ctxTrimmed': '上下文 {rounds}/{total} 轮 · 已裁掉 {dropped} 条',
  'input.ctxTrimmedTitle': '原 {totalMsg} 条消息，已裁剪为最近 {rounds} 轮（保留 {kept} 条）',

  // —— 思维链 ——
  'thinking.active': '深度思考中...',
  'thinking.done': '已完成深度思维链推演',
  'thinking.collapse': '收起思维链',
  'thinking.expand': '展开思维链',

  // —— 看板 ——
  'board.title': 'MYRIAD-MoE',
  'board.subtitle': '全息神经透视监控看板',
  'board.refreshTitle': '刷新看板数据',
  'board.resetTitle': '清零统计指标',
  'board.resetTitleReadonly': '只读令牌禁止清零统计',
  'board.mockNote': '以下数值为本地模拟，非真实遥测',
  'board.vram': '显存已分配',
  'board.vramPeak': '峰值 {v}M',
  'board.vramReserved': '保留 {v}M',
  'board.cudaEngine': 'CUDA GRAPH 引擎',
  'board.cudaFast': '极速',
  'board.slot': '推理槽位',
  'board.slotBusy': 'BUSY (推流中)',
  'board.slotIdle': 'IDLE (空闲)',
  'board.slotQueue': '单槽排队保障',
  'board.slotThread': '线程: {t}',
  'board.tokSpeed': '平均吐字速率',
  'board.tokTotal': '累计 {t} tokens',
  'board.artsSci': '文理双大核实时占比',
  'board.artsSciSub': '双核协同动态路由',
  'board.artsFull': '文科常识基盘 (Arts)',
  'board.sciFull': '理科宏核 (Sci)',
  'board.artsShort': '文科',
  'board.sciShort': '理科',
  'board.tabOverview': '宗门热力',
  'board.tabClusters': '禁闭所',
  'board.tabTopk': '弹性开核',
  'board.tabRadar': '神经雷达',
  'board.topTitle': '宗门活跃热力排行 (Top 6)',
  'board.topSub': '微专家集群命中率',
  'board.cagedBadge': '🔒 禁闭',
  'board.slotBadge': '💿 插槽',
  'board.clustersTotal': '共 {c} 宗门 · {e} 微专家',
  'board.viewAll': '查看全部 {c} 宗门',
  'board.snipeTitle': '单层狙击 (在第 N 层额外关押宗门 M)',
  'board.snipeDesc': '原地置零该层的 LoRA B 偏置并把本层路由打入冷宫，其余 {n} 层不受影响',
  'board.layerLabel': '层号',
  'board.clusterLabel': '宗门',
  'board.doSnipe': '执行狙击',
  'board.sniping': '狙击中...',
  'board.snipeReadonly': '只读令牌禁止执行神经手术',
  'board.snipeTip': '禁闭所列表里每个 L07 ✕ 按钮可单独解封某一层；「释放全部」则会恢复该宗门的所有被封杀层。',
  'board.cageTitle': '{c} 宗门禁闭管理所',
  'board.cageDesc': '全局禁闭会清零该宗门在所有 {l} 层的权重并封杀其路由',
  'board.hitsLabel': '命中 {h}',
  'board.cagedLayers': '封杀层',
  'board.cagedGlobal': '🔒 全局 · 全部 {l} 层',
  'board.snipeOnly': '🎯 单点解封',
  'board.freeLayerTitle': '点击仅解封第 {l} 层（其余层保持封杀）',
  'board.releaseAll': '释放全部',
  'board.releaseAllTitle': '释放该宗门的全部被封杀层',
  'board.cageBtn': '关禁闭',
  'board.cageBtnTitle': '在全部 {l} 层关禁闭',
  'board.topkTitle': '弹性开核调度台',
  'board.topkDesc': '实时调节异构金字塔每步激活的宗门小核数 (Top-K，1~10 核)',
  'board.scopeLabel': '调节范围:',
  'board.scopeAll': '全局 {l} 层统一',
  'board.scopeLayer': '单层精细调频',
  'board.pickLayer': '选择层号:',
  'board.layerOpt': 'Layer {l} (当前: {k} 核)',
  'board.topkLabel': '小核并发数 (Top-K):',
  'board.topkUnit': '{k} 核',
  'board.topkMin': '1 (极限省算力)',
  'board.topkStd': '4 (标准)',
  'board.topkMax': '10 (全开)',
  'board.perLayerExperts': '单层微专家并发:',
  'board.expertsUnit': '{n} 微专家',
  'board.wholeNet': '全网络推理并发:',
  'board.expertSlots': '{n} 专家槽位',
  'board.perLayerActive': '分层配置生效',
  'board.applying': '调频中...',
  'board.applyNow': '即时应用调频',
  'board.radarTitle': '{l} 层逐层主导宗门雷达',
  'board.radarDesc': '实时扫描各层前向激活权重最大的宗门与异常波动',
  'board.noActivation': '暂无激活数据',
  'board.abnormal': '🔥异常',
  'board.cartridgeTitle': '特区插槽卡带热插拔',
  'board.cartridgeDesc': '原地写插槽权重，无需重启，CUDA Graph 保持常驻。',
  'board.srcUpload': '本地文件上传',
  'board.srcPath': '服务端路径',
  'board.pathPh': '服务端路径 (如 cartridge_gongfang.pt)',
  'board.cancelPick': '取消选择',
  'board.slotLabel': '插槽',
  'board.slotTarget': '目标插槽',
  'board.hotplug': '热插拔',
  'board.hotplugReadonly': '只读令牌禁止热插拔',
  'board.implanting': '植入中...',
  'board.uploading': '上传中 {p}%',
  'board.mounted': '已挂载: {n}',
  'board.slotEmpty': '插槽 #{s} 当前为空',

  // —— 看板 toast ——
  'toast.cudaTo': 'CUDA Graph 已切换为: {v}',
  'toast.topk': '开核调频生效: {scope} 设置为 {k} 核',
  'toast.topkAll': '全局 {l} 层统一',
  'toast.topkLayer': '第 {l} 层',
  'toast.freed': '🔓 宗门 {label} 已刑满释放（其所有被封杀层均已恢复）',
  'toast.caged': '🔒 宗门 {label} 已关押，全 {l} 层路由打入冷宫',
  'toast.freeLayerSome': '🔓 {label} 第 {layer} 层已解封，仍有 {n} 层处于封杀',
  'toast.freeLayerAll': '🔓 {label} 第 {layer} 层已解封，该宗门已全部释放',
  'toast.sniped': '🎯 Layer {layer} · #{cid} {name} 已置零并封杀本层路由（注意：/free 会释放其全部层）',
  'toast.plugged': '⚡ 卡带《{n}》{src}植入插槽 #{s} 成功',
  'toast.pluggedUpload': '上传',
  'toast.pluggedPath': '路径',
  'toast.statsReset': '🧹 全息遥测统计已清零',

  // —— 配置弹窗 ——
  'cfg.title': 'Myriad-MoE 连接与推理配置',
  'cfg.subtitle': 'OpenAI 兼容端点及神经扩展控制',
  'cfg.baseUrl': 'API Base URL',
  'cfg.baseUrlHint': '需包含 /v1 前缀',
  'cfg.testConn': '测试连通',
  'cfg.connOk': '✅ 连通成功 ({ms}ms)',
  'cfg.connFail': '❌ 连通失败: {e}',
  'cfg.capReadonly': '· 只读令牌（写操作会被 403 拒绝）',
  'cfg.capAdmin': '· 管理员令牌',
  'cfg.capNoAuth': '· 服务端未开启鉴权',
  'cfg.capLoading': '· 模型仍在加载',
  'cfg.apiKey': 'API Key',
  'cfg.apiKeyReadonly': '当前：只读令牌',
  'cfg.apiKeyAdmin': '当前：管理员令牌',
  'cfg.apiKeyNone': '服务端未开鉴权时可留空',
  'cfg.apiKeyPh': 'sk-myriad (可选)',
  'cfg.modelId': '模型标识 (Model ID)',
  'cfg.systemPrompt': 'System 提示词',
  'cfg.systemPromptHint': '始终置于上下文首条',
  'cfg.systemPromptPh': '留空则不发送 system 消息。例：你是一个擅长数学推导的助手。',
  'cfg.ctxRounds': '上下文保留轮数',
  'cfg.ctxRoundsUnit': '{n} 轮',
  'cfg.ctxMin': '{n} (省算力)',
  'cfg.ctxDefault': '默认 {n}',
  'cfg.ctxMax': '{n} (长记忆)',
  'cfg.ctxDesc': '发送时只保留 System + 最近 {n} 轮，其余历史会被裁掉。服务端无状态，过长的 prompt 会挤占 KV 缓存并拖慢首字延迟。',
  'cfg.pollInterval': '看板轮询间隔',
  'cfg.pollPause': '生成期间自动暂停',
  'cfg.poll2': '2 秒 (较激进)',
  'cfg.poll5': '5 秒 (推荐)',
  'cfg.poll10': '10 秒',
  'cfg.poll30': '30 秒 (低功耗)',
  'cfg.pollDesc': '统计端点会在服务端做同步 GPU 操作，间隔过短会拖慢流式吐字。',
  'cfg.splitTitle': '独立思维链分流 (Split Reasoning)',
  'cfg.splitDesc': '将 <think> 解析为 reasoning_content 折叠卡片',
  'cfg.mockTitle': '离线演示兜底 (Mock Fallback)',
  'cfg.mockDesc': '仅在无法连接服务时启用虚拟推理机。API Key 错误、地址错误、模型未就绪等真实错误不会被兜底，会如实报错。',
  'cfg.mockWarn': '兜底启用时，所有回答与看板数值都会标注「模拟数据」横幅，请勿据此评估模型表现。',
  'cfg.focusTitle': '限定参战宗门 (Focus Clusters)',
  'cfg.focusAll': '默认全部 {c} 宗门参战',
  'cfg.focusSome': '已限定 {n} 个宗门（其余将被临时打入冷宫）',
  'cfg.focusClear': '清空限定',
  'cfg.focusScope': '生效范围：当前 {l} 层 · 请求级临时覆盖，不改变禁闭所状态。',
  'cfg.maxTokens': '最大回复 Tokens',
  'cfg.repPenalty': '重复惩罚 (Rep Penalty)',
  'cfg.save': '保存并应用配置',

  // —— App 内系统消息 ——
  'app.readonlyBlock': '🔒 当前使用的是**只读令牌**，无法调用模型生成回答。请在「配置中心」改用管理员 API Key。',
  'app.cleared': '🧹 上下文已清空。服务端为无状态模式，对话历史由本客户端维护。',
  'app.genFail': '❌ 生成失败：{d}',

  // —— 错误文案 ——
  'err.transport': '无法连接推理服务{tail}：{msg}',
  'err.timeout': '请求超时（3s）',
  'err.network': '网络请求失败',
  'err.401': 'API Key 无效或缺失（HTTP 401）。请在右上角「配置中心」检查 API Key。',
  'err.403': '当前令牌为只读权限，无权执行该写操作。请改用管理员 API Key。',
  'err.404': '端点不存在（HTTP 404）。Base URL 需要包含 /v1 前缀，例如 http://127.0.0.1:8000/v1',
  'err.413': '上传内容过大（HTTP 413）。',
  'err.413d': '上传内容过大（HTTP 413）：{d}',
  'err.503': '推理服务尚未就绪（HTTP 503）。',
  'err.503d': '推理服务尚未就绪（HTTP 503）：{d}',
  'err.400': '请求被服务端拒绝（HTTP 400）。',
  'err.400d': '请求被服务端拒绝（HTTP 400）：{d}',
  'err.streamUnsupported': '当前浏览器不支持流式响应 (ReadableStream 不可用)',
  'err.connFail': '连接失败',
} as const;

export type ZhKey = keyof typeof zh;

type EnDict = Record<ZhKey, string>;

const en: EnDict = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copyContent': 'Copy content',
  'common.copyMessage': 'Copy message',
  'common.openConfig': 'Open settings',
  'common.switchKey': 'Switch key',
  'common.noData': 'No data yet. Make sure the service is up and the model has finished loading.',
  'common.hits_unit': 'hits',

  'header.title': 'Myriad-MoE Console',
  'header.subtitle': 'Model: {model} · Dual-core · 25,200 micro-experts',
  'header.resetSession': 'Reset session',
  'header.resetSessionTitle': 'Clear conversation memory',
  'header.configCenter': 'Settings',
  'header.configCenterTitle': 'Configure Base URL and inference params',
  'header.collapseBoard': 'Hide board',
  'header.expandBoard': 'Holo board',
  'header.toggleBoardTitle': 'Expand / collapse the neural telemetry board',
  'header.readonly': 'Read-only',
  'header.readonlyTitle': 'Current token is read-only; writes are rejected by the server (403)',
  'header.noAuth': 'No auth',
  'header.noAuthTitle': 'Server runs without --api-key / --read-only-key; anyone can operate it',
  'status.online': 'Online',
  'status.mock': 'Mock demo',
  'status.offline': 'Offline',
  'status.loading': 'Loading model',

  'banner.readonlyTitle': 'Read-only mode',
  'banner.readonlyBody': 'You can view telemetry, but cannot generate answers or cage / snipe / tune / hot-plug. Switch to an admin API key in Settings for those.',
  'banner.mockTitle': 'Currently showing local mock data',
  'banner.mockBody': 'not real model output',
  'banner.mockReason': 'Reason: ',
  'banner.loadingTitle': 'Service is up, model weights still loading',
  'banner.loadingBody': 'You can chat once loading finishes; the board will refresh automatically',
  'banner.offlineTitle': 'Inference service unreachable',

  'empty.title': 'Myriad-MoE Neural Holographic Client',
  'empty.desc': 'Connected to a self-hosted 25,200 micro-expert model service. Supports holographic neural introspection, folded chain-of-thought, per-layer Top-K and live cluster caging.',
  'empty.card1Title': 'Arts/Sci dual-core test',
  'empty.card1Desc': 'Evaluate dynamic compute split between Arts base and Sci core plus math reasoning',
  'empty.card1Prompt': 'Test arts/sci dual-core collaboration: derive quicksort and analyze its complexity',
  'empty.card2Title': 'Run /catch neural radar scan',
  'empty.card2Desc': 'Detect per-layer activation hits and dominant clusters across 28 layers',
  'empty.card3Title': 'Open holo board (/stats)',
  'empty.card3Desc': 'Get current arts/sci split, top-cluster ranking and CUDA Graph status',
  'empty.card4Title': 'Inspect 20 clusters (/clusters)',
  'empty.card4Desc': 'View per-cluster hits, cage status and cartridge mounts',

  'msg.commandBadge': '⚡ Command reply',
  'msg.localBadge': 'Local note',
  'msg.localBadgeTitle': 'Local note, never sent back to the model as context',
  'msg.streaming': 'Dispatching neural micro-experts...',
  'msg.regenerate': 'Regenerate',
  'msg.ttftTitle': 'TTFT',

  'telemetry.thisRoute': 'Route',
  'telemetry.arts': 'Arts',
  'telemetry.sci': 'Sci',
  'telemetry.leading': 'Top',

  'slash.title': 'Myriad-MoE native slash commands',
  'slash.hint': 'Click to fill the input',
  'slash.catch': 'Scan dominant cluster per layer (28 layers)',
  'slash.stats': 'Arts/Sci cores + holographic telemetry',
  'slash.clusters': 'List 20 clusters: hits & cage state',
  'slash.show_k': 'Show per-layer Top-K & concurrency',
  'slash.set_k': 'Tune Top-K for one layer',
  'slash.set_k_all': 'Tune Top-K for all 28 layers',
  'slash.cage': 'Cage a cluster globally (e.g. /cage 16)',
  'slash.free': 'Free a cluster (restores all its layers)',
  'slash.snipe': 'Snipe one layer (e.g. /snipe 21 16)',
  'slash.graph': 'Toggle CUDA Graph engine',
  'slash.clear': 'Clear local context',
  'slash.help': 'Show full Myriad command guide',

  'input.placeholder': 'Type a message, or / for neural introspection commands (/catch, /stats, /show_k)...',
  'input.commandsTitle': 'Command list',
  'input.interrupt': 'Stop',
  'input.hint': 'Enter to send · Shift+Enter for newline · / for commands',
  'input.ctxTrimmed': 'Context {rounds}/{total} rounds · trimmed {dropped}',
  'input.ctxTrimmedTitle': '{totalMsg} messages total, kept latest {rounds} rounds ({kept} messages)',

  'thinking.active': 'Thinking...',
  'thinking.done': 'Chain-of-thought complete',
  'thinking.collapse': 'Collapse',
  'thinking.expand': 'Expand',

  'board.title': 'MYRIAD-MoE',
  'board.subtitle': 'Holographic neural monitor',
  'board.refreshTitle': 'Refresh board data',
  'board.resetTitle': 'Reset stats',
  'board.resetTitleReadonly': 'Read-only token cannot reset stats',
  'board.mockNote': 'Values below are local mock data, not real telemetry',
  'board.vram': 'VRAM allocated',
  'board.vramPeak': 'Peak {v}M',
  'board.vramReserved': 'Reserved {v}M',
  'board.cudaEngine': 'CUDA GRAPH ENGINE',
  'board.cudaFast': 'Boost',
  'board.slot': 'Inference slot',
  'board.slotBusy': 'BUSY (streaming)',
  'board.slotIdle': 'IDLE',
  'board.slotQueue': 'Single-slot queue',
  'board.slotThread': 'Thread: {t}',
  'board.tokSpeed': 'Avg decode speed',
  'board.tokTotal': '{t} tokens total',
  'board.artsSci': 'Arts / Sci live split',
  'board.artsSciSub': 'Dual-core dynamic routing',
  'board.artsFull': 'Arts base',
  'board.sciFull': 'Sci core',
  'board.artsShort': 'Arts',
  'board.sciShort': 'Sci',
  'board.tabOverview': 'Heatmap',
  'board.tabClusters': 'Cage',
  'board.tabTopk': 'Top-K',
  'board.tabRadar': 'Radar',
  'board.topTitle': 'Cluster heat ranking (Top 6)',
  'board.topSub': 'Micro-expert cluster hit rate',
  'board.cagedBadge': '🔒 Caged',
  'board.slotBadge': '💿 Slot',
  'board.clustersTotal': '{c} clusters · {e} micro-experts',
  'board.viewAll': 'View all {c} clusters',
  'board.snipeTitle': 'Single-layer snipe (cage cluster M at layer N)',
  'board.snipeDesc': 'Zero out that layer\u2019s LoRA B bias and cage routing there; other {n} layers untouched',
  'board.layerLabel': 'Layer',
  'board.clusterLabel': 'Cluster',
  'board.doSnipe': 'Snipe now',
  'board.sniping': 'Sniping...',
  'board.snipeReadonly': 'Read-only token cannot run neural surgery',
  'board.snipeTip': 'Each L07 ✕ button frees a single layer; “Release all” restores every caged layer of that cluster.',
  'board.cageTitle': '{c}-cluster cage manager',
  'board.cageDesc': 'Global cage zeroes this cluster\u2019s weights on all {l} layers and cages its routing',
  'board.hitsLabel': '{h} hits',
  'board.cagedLayers': 'Caged layers',
  'board.cagedGlobal': '🔒 Global · all {l} layers',
  'board.snipeOnly': '🎯 Single-layer',
  'board.freeLayerTitle': 'Free only layer {l} (others stay caged)',
  'board.releaseAll': 'Release all',
  'board.releaseAllTitle': 'Release every caged layer of this cluster',
  'board.cageBtn': 'Cage',
  'board.cageBtnTitle': 'Cage on all {l} layers',
  'board.topkTitle': 'Elastic Top-K console',
  'board.topkDesc': 'Tune active sub-kernels per step (Top-K, 1–10)',
  'board.scopeLabel': 'Scope:',
  'board.scopeAll': 'All {l} layers',
  'board.scopeLayer': 'Single layer',
  'board.pickLayer': 'Layer:',
  'board.layerOpt': 'Layer {l} (now: {k})',
  'board.topkLabel': 'Concurrent sub-kernels (Top-K):',
  'board.topkUnit': '{k}',
  'board.topkMin': '1 (min compute)',
  'board.topkStd': '4 (default)',
  'board.topkMax': '10 (full)',
  'board.perLayerExperts': 'Experts / layer:',
  'board.expertsUnit': '{n} experts',
  'board.wholeNet': 'Network-wide concurrency:',
  'board.expertSlots': '{n} expert slots',
  'board.perLayerActive': 'Per-layer config active',
  'board.applying': 'Applying...',
  'board.applyNow': 'Apply now',
  'board.radarTitle': '{l}-layer dominant-cluster radar',
  'board.radarDesc': 'Scan the top-weighted cluster and anomalies per layer',
  'board.noActivation': 'No activation data',
  'board.abnormal': '🔥Anomaly',
  'board.cartridgeTitle': 'SAR slot cartridge hot-plug',
  'board.cartridgeDesc': 'Write slot weights in place, no restart; CUDA Graph stays resident.',
  'board.srcUpload': 'Upload file',
  'board.srcPath': 'Server path',
  'board.pathPh': 'Server path (e.g. cartridge_gongfang.pt)',
  'board.cancelPick': 'Clear selection',
  'board.slotLabel': 'Slot',
  'board.slotTarget': 'Target slot',
  'board.hotplug': 'Hot-plug',
  'board.hotplugReadonly': 'Read-only token cannot hot-plug',
  'board.implanting': 'Implanting...',
  'board.uploading': 'Uploading {p}%',
  'board.mounted': 'Mounted: {n}',
  'board.slotEmpty': 'Slot #{s} is empty',

  'toast.cudaTo': 'CUDA Graph switched to: {v}',
  'toast.topk': 'Top-K applied: {scope} set to {k}',
  'toast.topkAll': 'all {l} layers',
  'toast.topkLayer': 'layer {l}',
  'toast.freed': '🔓 Cluster {label} released (all its caged layers restored)',
  'toast.caged': '🔒 Cluster {label} caged, routing chilled on all {l} layers',
  'toast.freeLayerSome': '🔓 {label} layer {layer} freed, {n} layers still caged',
  'toast.freeLayerAll': '🔓 {label} layer {layer} freed, cluster fully released',
  'toast.sniped': '🎯 Layer {layer} · #{cid} {name} zeroed and caged (note: /free releases all its layers)',
  'toast.plugged': '⚡ Cartridge “{n}” {src} implanted into slot #{s}',
  'toast.pluggedUpload': 'upload',
  'toast.pluggedPath': 'path',
  'toast.statsReset': '🧹 Telemetry stats cleared',

  'cfg.title': 'Myriad-MoE connection & inference settings',
  'cfg.subtitle': 'OpenAI-compatible endpoint plus neural extensions',
  'cfg.baseUrl': 'API Base URL',
  'cfg.baseUrlHint': 'Must include the /v1 prefix',
  'cfg.testConn': 'Test',
  'cfg.connOk': '✅ Connected ({ms}ms)',
  'cfg.connFail': '❌ Connection failed: {e}',
  'cfg.capReadonly': '· read-only token (writes get 403)',
  'cfg.capAdmin': '· admin token',
  'cfg.capNoAuth': '· server auth disabled',
  'cfg.capLoading': '· model still loading',
  'cfg.apiKey': 'API Key',
  'cfg.apiKeyReadonly': 'Current: read-only token',
  'cfg.apiKeyAdmin': 'Current: admin token',
  'cfg.apiKeyNone': 'Leave empty when server auth is off',
  'cfg.apiKeyPh': 'sk-myriad (optional)',
  'cfg.modelId': 'Model ID',
  'cfg.systemPrompt': 'System prompt',
  'cfg.systemPromptHint': 'Always first in context',
  'cfg.systemPromptPh': 'Empty = no system message. E.g.: You are a math-savvy assistant.',
  'cfg.ctxRounds': 'Context rounds to keep',
  'cfg.ctxRoundsUnit': '{n} rounds',
  'cfg.ctxMin': '{n} (save compute)',
  'cfg.ctxDefault': 'Default {n}',
  'cfg.ctxMax': '{n} (long memory)',
  'cfg.ctxDesc': 'Only System + latest {n} rounds are sent; older history is trimmed. The server is stateless — long prompts eat KV cache and slow TTFT.',
  'cfg.pollInterval': 'Board poll interval',
  'cfg.pollPause': 'Auto-pauses while generating',
  'cfg.poll2': '2s (aggressive)',
  'cfg.poll5': '5s (recommended)',
  'cfg.poll10': '10s',
  'cfg.poll30': '30s (low power)',
  'cfg.pollDesc': 'The stats endpoint does sync GPU work server-side; polling too fast slows streaming.',
  'cfg.splitTitle': 'Split reasoning stream',
  'cfg.splitDesc': 'Parse <think> into a folded reasoning_content card',
  'cfg.mockTitle': 'Offline mock fallback',
  'cfg.mockDesc': 'Only when the service is unreachable. Real errors (bad key, bad URL, model not ready) are never mocked and surface as-is.',
  'cfg.mockWarn': 'While enabled, all answers and board values carry a “mock data” banner — do not benchmark the model on them.',
  'cfg.focusTitle': 'Focus clusters',
  'cfg.focusAll': 'All {c} clusters active by default',
  'cfg.focusSome': '{n} clusters pinned (others chilled)',
  'cfg.focusClear': 'Clear',
  'cfg.focusScope': 'Scope: current {l} layers · per-request override, cage state untouched.',
  'cfg.maxTokens': 'Max reply tokens',
  'cfg.repPenalty': 'Repetition penalty',
  'cfg.save': 'Save & apply',

  'app.readonlyBlock': '🔒 This is a **read-only token** and cannot generate. Switch to an admin API key in Settings.',
  'app.cleared': '🧹 Context cleared. The server is stateless; history is kept by this client.',
  'app.genFail': '❌ Generation failed: {d}',

  'err.transport': 'Cannot reach inference service{tail}: {msg}',
  'err.timeout': 'Request timed out (3s)',
  'err.network': 'Network request failed',
  'err.401': 'Invalid or missing API key (HTTP 401). Check it in Settings (top right).',
  'err.403': 'Read-only token: not allowed to run this write. Use an admin API key.',
  'err.404': 'Endpoint not found (HTTP 404). Base URL must include the /v1 prefix, e.g. http://127.0.0.1:8000/v1',
  'err.413': 'Upload too large (HTTP 413).',
  'err.413d': 'Upload too large (HTTP 413): {d}',
  'err.503': 'Inference service not ready yet (HTTP 503).',
  'err.503d': 'Inference service not ready yet (HTTP 503): {d}',
  'err.400': 'Rejected by server (HTTP 400).',
  'err.400d': 'Rejected by server (HTTP 400): {d}',
  'err.streamUnsupported': 'This browser lacks streaming support (no ReadableStream)',
  'err.connFail': 'Connection failed',
};

const dicts: Record<Lang, Record<ZhKey, string>> = { zh, en };

/** 模板插值：t('board.vramPeak', { v: 123 }) */
export function fmt(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    return v === undefined ? m : String(v);
  });
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: ZhKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LangCtx>({
  lang: 'zh',
  setLang: () => {},
  toggleLang: () => {},
  t: key => key,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const toggleLang = useCallback(() => {
    setLangState(prev => {
      const next: Lang = prev === 'zh' ? 'en' : 'zh';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
      document.title = lang === 'zh' ? 'Myriad-MoE 神经透视控制台' : 'Myriad-MoE Neural Console';
    } catch {}
  }, [lang]);

  const t = useCallback(
    (key: ZhKey, vars?: Record<string, string | number>) => fmt(dicts[lang][key] ?? dicts.zh[key] ?? key, vars),
    [lang],
  );

  return <Ctx.Provider value={{ lang, setLang, toggleLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}

export function LangToggle({ compact = false }: { compact?: boolean }) {
  const { lang, toggleLang } = useLang();
  return (
    <button
      onClick={toggleLang}
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      className={`rounded-lg border text-[11px] font-mono transition-colors flex items-center gap-1 ${
        compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
      } bg-slate-800/60 border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-700`}
    >
      <span className={lang === 'zh' ? 'text-cyan-300 font-bold' : 'opacity-60'}>中</span>
      <span className="opacity-40">/</span>
      <span className={lang === 'en' ? 'text-cyan-300 font-bold' : 'opacity-60'}>EN</span>
    </button>
  );
}
