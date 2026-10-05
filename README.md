# Myriad-MoE 神经透视控制台

Myriad-MoE 25,200 微专家大模型的 Web 客户端，对接一个 OpenAI 兼容的推理服务（参考实现为 `7.api_myriad_server.py`）。

- **左侧**：ChatGPT 风格对话区，支持思维链折叠、斜杠指令、重新生成
- **右侧**：全息神经透视看板 —— 文理双核占比、宗门热力、禁闭所 / 单层狙击、弹性开核、逐层雷达、卡带热插拔

> 本仓库**只含前端**。后端推理服务与模型权重（`myriad_*.pt`）不在这里，需要单独部署。

---

## 快速开始

### 1. 启动后端

在服务端仓库根目录：

```bash
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]"
.venv/bin/python 7.api_myriad_server.py \
  --host 0.0.0.0 --port 8000 \
  --weights myriad_moe_hierarchical_weights.pt \
  --backend-script 6.chat_myriad_25k_lora_fast_more_mirco.py
```

模型加载需要一段时间，期间：

- `GET /health` → `{"status": "loading", "ready": false}`
- `GET /v1/models` → **200**，但 `data[0].myriad.layers` 为 `null`（客户端据此判断「加载中」）
- `GET /v1/chat/completions` → **503** + `startup_error`
- 所有 `GET/POST /v1/myriad/*` → **503** + `模型正在加载中 ...`

客户端顶部徽章此时显示 **模型加载中**（蓝色转圈）而非红色报错，加载完成后自动转为「服务在线」，看板开始刷新。

可选鉴权：加 `--api-key sk-xxx`，之后所有请求需带 `Authorization: Bearer sk-xxx`。

### 2. 启动前端

```bash
npm install
npm run dev
```

打开 http://localhost:3000

### 3. 连接

点右上角「配置中心」，确认 **API Base URL** 为：

```
http://127.0.0.1:8000/v1
```

**必须包含 `/v1` 前缀** —— 服务端所有业务端点都挂在 `/v1` 下。填错会得到 404，客户端会明确提示这一点。

填好 API Key（若后端启用了鉴权）后点「测试连通」。

---

## 离线演示模式

没有 GPU 时也能完整体验控制台 UI：

1. 配置中心 → 勾选 **离线演示兜底 (Mock Fallback)**
2. 顶栏徽章变为「模拟演示中」，聊天区和看板都会显示醒目的**模拟数据横幅**

该模式**默认关闭**，且只在「完全连不上服务」时启用。以下真实错误**不会**被兜底，会如实报错：

| 情况 | HTTP | 客户端行为 |
|---|---|---|
| API Key 错误 | 401 | 报错，提示去配置中心检查 Key |
| Base URL 漏了 `/v1` | 404 | 报错，明确提示需要 `/v1` 前缀 |
| 模型尚未加载完成 | 503 | 报错，显示服务端返回的 `startup_error` |
| 参数非法（层号/宗门号越界等） | 400 | 报错，显示服务端 `detail` |
| 生成线程异常（CUDA OOM 等） | SSE `error` 帧 | 报错，不会伪装成空回答 |

这样设计是为了避免「配置错了却以为模型在正常运行」。

---

## 斜杠指令

服务端无状态，对话历史由本客户端维护并每次全量发送。

| 指令 | 作用 |
|---|---|
| `/help` | 能力速查 |
| `/clear` | **清空本地上下文**（真正清空 `messages`） |
| `/stats` | 文理双核占比 + Top 宗门 + CUDA Graph 状态 |
| `/clusters` | 20 宗门命中数与禁闭状态 |
| `/show_k` | 各层开核数 |
| `/set_k <层> <核数>` | 单层调频 |
| `/set_k_all <核数>` | 全局调频 |
| `/cage <宗门>` | 全局禁闭（清零该宗门全部层权重 + 封杀路由） |
| `/free <宗门>` | 释放（**总是整宗释放**，见下方说明） |
| `/snipe <层> <宗门>` | 单层狙击 |
| `/plug <卡带.pt> [插槽]` | 卡带热插拔 |
| `/graph` | 切换 CUDA Graph |
| `/maxlen <n>` | 修改默认回复上限 |

### 关于 cage / snipe / free 的关系

服务端把两者存在**同一个状态表**里（`_caged[cid]` 是以层号为 key 的 dict）：

- `cage(cid)` → 写入全部 28 层 = **全局禁闭**
- `snipe(layer, cid)` → 只写入 1 层 = **单层狙击**
- `free(cid)` → 恢复该宗门**所有**已记录层，然后整体删除该条目
- `free(cid, layer)` → **只恢复该层**；若该宗门已无其他层封杀，才整体摘除

两种撤销粒度都可用：

| 操作 | 端点 | 效果 |
|---|---|---|
| 释放全部 | `POST /v1/myriad/clusters/{cid}/free` | 恢复该宗门所有被封杀层 |
| 单点解封 | `POST /v1/myriad/clusters/{cid}/free?layer=7` | 只恢复第 7 层 |

禁闭所面板里每个 `L07 ✕` 按钮就是单点解封；「释放全部」按钮则是整宗释放。层级来源通过服务端新增的 `caged_layer_map` 字段显示，返回值里的 `fully_released` / `still_caged_layers` 可判断是否已彻底释放。

---

## 权限分级（只读令牌）

服务端支持两种令牌：

| 令牌 | 参数 | 权限 |
|---|---|---|
| 管理员 | `--api-key` | 全部：遥测 + 神经手术 + 调频 + 热插拔 + 生成 |
| 只读 | `--read-only-key` | 仅 `GET` 遥测/看板；**所有写操作返回 403** |

```bash
python 7.api_myriad_server.py --api-key sk-admin --read-only-key sk-viewer
```

`GET /v1/models` 在 `myriad` 字段回报当前令牌等级，客户端据此：

- 顶部显示 **只读** 徽章 + 紫色横幅说明受限范围
- **禁用**所有写按钮（关禁闭 / 释放 / 狙击 / 单层解封 / 调频 / 热插拔 / 清零统计 / CUDA Graph 切换）
- 拦截发送消息，避免发起注定 403 的请求
- 配置中心「测试连通」直接显示当前令牌是只读还是管理员

服务端未配置任何 key 时，前端显示 **未鉴权** 徽章，提醒任何人都能操作。

## 卡带上传

禁闭所面板的热插拔支持两种来源：

- **本地文件上传** —— 选 `.pt` 文件经 multipart 直传（带上传进度条）
- **服务端路径** —— 填服务端进程工作目录下的文件名

上传受 `--max-cartridge-mb` 限制（默认 512MB），超出返回 413 并在前端给出可读提示。文件名只用于展示与记录，不参与路径拼接，服务端会做 `basename` 净化。

---

## 上下文滑动窗口

服务端无状态，客户端每次都把历史发过去。为避免 prompt 无限膨胀，发送前自动裁剪为：

```
[system 提示词（始终保留）] + 最近 N 轮对话
```

一轮 = 一个 user 消息 + 其后连续的 assistant 消息。`N` 默认 **10**，可在配置中心调 **4~30**。

同时自动剔除：本地提示（错误回显、`/clear` 确认语）、内容为空的 assistant 消息（生成被中断时残留，部分 chat template 会因此报错）、仍在流式输出的占位。

发生裁剪时输入框下方会显示 `上下文 10/10 轮 · 已裁掉 N 条`。

---

## 本次问答遥测

客户端固定下发 `myriad: { stats: true }`，服务端在流式响应的**最后一帧**（`[DONE]` 之前）附带本次请求专属的遥测：

```json
{"choices": [], "usage": {...},
 "myriad": {"arts_core_pct": 62.0, "sci_core_pct": 38.0,
            "cuda_graph": true, "top_clusters": [...]}}
```

聊天区每条回答底部会显示一条遥测带：本次文理双核占比条、CUDA Graph 状态、主导宗门（禁闭中的会加删除线）。

---

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8000/v1` | 必须含 `/v1` |
| `apiKey` | 空 | 后端 `--api-key` 开启时必填 |
| `model` | `myriad-moe-25k-lora` | 对应服务端 `SERVED_MODEL_ID` |
| `systemPrompt` | 空 | 始终置于上下文首条；留空则不发送 system 消息 |
| `contextRounds` | 10 | 上下文保留轮数（4~30） |
| `temperature` | 0.7 | |
| `topP` | 0.9 | |
| `maxTokens` | 1024 | 服务端会 clamp 到 `[1, 8192]` |
| `repetitionPenalty` | 1.15 | 服务端原生默认 |
| `splitReasoning` | true | 把 `<think>` 分流到 `reasoning_content` |
| `pollIntervalMs` | 5000 | 看板轮询间隔；**生成期间自动暂停** |
| `mockFallback` | false | 见上文 |
| `focusClusters` | `[]` | 非空时，本次请求未列出的宗门被临时打入冷宫 |
| `topKOverride` | `null` | 请求级 Top-K 覆盖 |

配置与聊天历史都存在 `localStorage`。

---

## 已知约束

- **单槽位解码**：服务端一次只处理一个生成请求，并发请求会排队（看板可见 `waiting_requests`）。
- **看板轮询会占用 GPU**：`/v1/myriad/stats` 在服务端做 28 次 `.cpu()` 同步拷贝。因此客户端在生成期间暂停轮询，间隔默认 5s。调得太激进会拖慢吐字。
- **流式遥测也含一次 `dashboard()`**：每条回答末尾的遥测帧会让服务端额外做一次统计快照（每请求 1 次，比原先每 2 秒轮询一次更省）。
- **遥测里的 `slot_state` 可能是 `busy`**：该字段在响应尚未关闭时读取，此时生成线程的信号量还没归还。看板下一次轮询会自动纠正。
- **`127.0.0.1` 指浏览器所在机器**：从别的电脑访问前端时，需把 Base URL 改成后端真实 IP。
- **历史只保留最近 N 轮**：受上下文滑动窗口限制，更早的内容模型已经看不到。

---

## 开发

```bash
npm run typecheck      # tsc --noEmit
npm run verify         # typecheck + 全部前端逻辑测试
npm run build          # 产物在 dist/
npm run preview
```

### 测试分层

| 命令 | 覆盖内容 | 依赖后端 |
|---|---|---|
| `npm run verify:client` | 错误分流、SSE 解析、公式渲染、上下文滑动窗口 | 否 |
| `npm run verify:server` | API 契约（路由 / 鉴权 / CORS / 错误码 / 流式遥测）、加载期行为、轮询策略 | 是 |

`verify:server` 需要 `7.api_myriad_server.py`。默认向上级目录查找，也可用环境变量指定：

```bash
MYRIAD_SERVER=/path/to/7.api_myriad_server.py npm run verify:server
```

找不到时会**自动跳过**并打印说明（退出码 0），因此独立克隆本仓库时 `npm run verify` 不会失败。它还会用到 `fastapi` 与 `torch`，请在安装了后端依赖的 Python 环境下运行。

技术栈：React 19 + TypeScript + Vite 8 + Tailwind CSS 4。KaTeX 与字体样式均为**本地依赖**，不依赖任何 CDN（内网环境可用）。