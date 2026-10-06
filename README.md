# Myriad-MoE Neural Console

> **中文版**: [README.zh-CN.md](README.zh-CN.md)

Web client for the Myriad-MoE 25,200 micro-expert model, talking to an OpenAI-compatible inference service (reference implementation: `7.api_myriad_server.py`).

- **Left**: ChatGPT-style conversation area with foldable chain-of-thought, slash commands, regeneration
- **Right**: holographic neural introspection board — arts/sci core split, cluster heatmap, cage / single-layer snipe, elastic Top-K, per-layer radar, cartridge hot-plug
- **Language**: 中文 / English toggle in the top bar (persisted in `localStorage`)

> This repo contains **only the frontend**. The backend inference service and model weights (`myriad_*.pt`, see [🤗 Hugging Face](https://huggingface.co/aifeifei798/Myriad-MoE-25K-Micro-Experts)) live elsewhere and must be deployed separately.

---

## Quick start

### 1. Start the backend

In the server repo root:

```bash
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]"
.venv/bin/python 7.api_myriad_server.py \
  --host 0.0.0.0 --port 8000 \
  --weights myriad_moe_hierarchical_weights.pt \
  --backend-script 6.chat_myriad_25k_lora_fast_more_mirco.py
```

Model loading takes a while. During that window:

- `GET /health` → `{"status": "loading", "ready": false}`
- `GET /v1/models` → **200**, but `data[0].myriad.layers` is `null` (the client uses this to detect "loading")
- `GET /v1/chat/completions` → **503** + `startup_error`
- All `GET/POST /v1/myriad/*` → **503** + `model is still loading ...`

The top badge shows **Loading model** (blue spinner) instead of a red error, then flips to "Online" automatically once loading finishes and the board starts refreshing.

Optional auth: pass `--api-key sk-xxx`, after which every request needs `Authorization: Bearer sk-xxx`.

### 2. Start the frontend

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 3. Connect

Click **Settings** (top right) and confirm **API Base URL** is:

```
http://127.0.0.1:8000/v1
```

The **`/v1` prefix is mandatory** — every business endpoint lives under `/v1`. A missing prefix yields 404, which the client explains explicitly.

Fill in the API Key (if the backend has auth enabled) and hit **Test**.

---

## Offline demo mode

No GPU? You can still explore the full console UI:

1. Settings → check **Offline mock fallback**
2. The top badge switches to "Mock demo", and both chat and board show a prominent **mock data banner**

This mode is **off by default** and only kicks in when the service is completely unreachable. These real errors are **never** mocked and always surface as-is:

| Situation | HTTP | Client behavior |
|---|---|---|
| Wrong API key | 401 | Error, points you to Settings to check the key |
| Base URL missing `/v1` | 404 | Error, explicitly mentions the `/v1` prefix |
| Model still loading | 503 | Error, shows the server's `startup_error` |
| Illegal params (layer/cluster out of range, …) | 400 | Error, shows the server `detail` |
| Generation thread crash (CUDA OOM, …) | SSE `error` frame | Error, never disguised as an empty answer |

This is deliberate — a misconfiguration should never look like "the model is running fine".

---

## Slash commands

The server is stateless; the client owns the conversation history and resends it every turn.

| Command | Effect |
|---|---|
| `/help` | Capability cheat sheet |
| `/clear` | **Clear local context** (actually empties `messages`) |
| `/stats` | Arts/sci split + top clusters + CUDA Graph status |
| `/clusters` | Hit counts and cage state of the 20 clusters |
| `/show_k` | Per-layer Top-K |
| `/set_k <layer> <k>` | Tune one layer |
| `/set_k_all <k>` | Tune all layers |
| `/cage <cluster>` | Global cage (zero all layers' weights of that cluster + chill its routing) |
| `/free <cluster>` | Release (**always releases the whole cluster**, see below) |
| `/snipe <layer> <cluster>` | Single-layer snipe |
| `/plug <cartridge.pt> [slot]` | Cartridge hot-plug |
| `/graph` | Toggle CUDA Graph |
| `/maxlen <n>` | Change default reply length |

### How cage / snipe / free relate

The server keeps both in the **same state table** (`_caged[cid]` is a dict keyed by layer):

- `cage(cid)` → writes all 28 layers = **global cage**
- `snipe(layer, cid)` → writes 1 layer = **single-layer snipe**
- `free(cid)` → restores **all** recorded layers of that cluster, then drops the entry
- `free(cid, layer)` → restores **only that layer**; the entry is dropped only once no caged layer remains

Both release granularities are available:

| Action | Endpoint | Effect |
|---|---|---|
| Release all | `POST /v1/myriad/clusters/{cid}/free` | Restore every caged layer of that cluster |
| Free one layer | `POST /v1/myriad/clusters/{cid}/free?layer=7` | Restore only layer 7 |

Each `L07 ✕` button in the cage panel is a single-layer free; the "Release all" button frees the whole cluster. Caged layers are shown via the server's `caged_layer_map` field; `fully_released` / `still_caged_layers` in the response tell whether the release is complete.

---

## Permission tiers (read-only token)

The server supports two token kinds:

| Token | Flag | Permissions |
|---|---|---|
| Admin | `--api-key` | Everything: telemetry + neural surgery + tuning + hot-plug + generation |
| Read-only | `--read-only-key` | Only `GET` telemetry/board; **every write returns 403** |

```bash
python 7.api_myriad_server.py --api-key sk-admin --read-only-key sk-viewer
```

`GET /v1/models` reports the current token tier in the `myriad` field, and the client accordingly:

- Shows a **Read-only** badge + purple banner explaining the limits
- **Disables** all write buttons (cage / release / snipe / single-layer free / tuning / hot-plug / stats reset / CUDA Graph toggle)
- Blocks message sending to avoid doomed 403 requests
- The Settings "Test" button directly reports whether the current token is read-only or admin

When the server has no key configured, the UI shows a **No auth** badge as a reminder that anyone can operate it.

## Cartridge upload

Hot-plug in the cage panel supports two sources:

- **Local file upload** — pick a `.pt` file, uploaded via multipart with a progress bar
- **Server path** — a filename under the server process working directory

Uploads are capped by `--max-cartridge-mb` (default 512 MB); over-limit uploads return 413 with a readable message. The filename is display/record only and never used for path joining — the server sanitizes it with `basename`.

---

## Context sliding window

The server is stateless, so the client resends history every turn. To keep prompts from growing forever, history is trimmed before sending to:

```
[system prompt (always kept)] + latest N rounds
```

One round = one user message + the assistant messages that follow it. `N` defaults to **10**, adjustable **4–30** in Settings.

Also stripped automatically: local notes (error echoes, `/clear` confirmations), empty assistant messages (leftovers from interrupted generation — some chat templates choke on them), and in-flight streaming placeholders.

When trimming happens, a `Context 10/10 rounds · trimmed N` note appears under the input box.

---

## Per-answer telemetry

The client always sends `myriad: { stats: true }`, and the server attaches request-scoped telemetry in the **last frame** of the stream (before `[DONE]`):

```json
{"choices": [], "usage": {...},
 "myriad": {"arts_core_pct": 62.0, "sci_core_pct": 38.0,
            "cuda_graph": true, "top_clusters": [...]}}
```

Every answer in the chat area carries a telemetry strip at the bottom: arts/sci split bar, CUDA Graph state, dominant clusters (caged ones struck through).

---

## Settings reference

| Field | Default | Notes |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8000/v1` | Must include `/v1` |
| `apiKey` | empty | Required when backend `--api-key` is on |
| `model` | `myriad-moe-25k-lora` | Matches server `SERVED_MODEL_ID` |
| `systemPrompt` | empty | Always first in context; empty = no system message sent |
| `contextRounds` | 10 | Context rounds to keep (4–30) |
| `temperature` | 0.7 | |
| `topP` | 0.9 | |
| `maxTokens` | 1024 | Server clamps to `[1, 8192]` |
| `repetitionPenalty` | 1.15 | Server native default |
| `splitReasoning` | true | Split `<think>` into `reasoning_content` |
| `pollIntervalMs` | 5000 | Board poll interval; **auto-pauses while generating** |
| `mockFallback` | false | See above |
| `focusClusters` | `[]` | Non-empty: unlisted clusters are chilled for this request |
| `topKOverride` | `null` | Per-request Top-K override |

Settings and chat history are stored in `localStorage`.

---

## UI language

The top bar has a 中/EN toggle; the choice persists in `localStorage` (`myriad_lang`, defaults to the browser language). It covers all UI chrome, banners, toasts and error hints. Model-generated content itself is never translated.

---

## Known constraints

- **Single-slot decoding**: the server handles one generation request at a time; concurrent requests queue (`waiting_requests` visible on the board).
- **Board polling costs GPU**: `/v1/myriad/stats` does 28 synchronous `.cpu()` copies server-side. So the client pauses polling while generating, default interval 5 s. Polling too aggressively slows down token streaming.
- **Streaming telemetry also runs one `dashboard()`**: the telemetry frame at the end of each answer costs one extra stats snapshot per request (cheaper than the old 2 s polling).
- **`slot_state` may read `busy`**: it is sampled before the response closes, while the generation thread hasn't released its semaphore yet. The next board poll self-corrects.
- **`127.0.0.1` means the browser's machine**: when opening the UI from another computer, point Base URL at the backend's real IP.
- **Only the latest N rounds are visible to the model**: limited by the context sliding window.

---

## Development

```bash
npm run typecheck      # tsc --noEmit
npm run verify         # typecheck + all frontend logic tests
npm run build          # output in dist/
npm run preview
```

### Test layers

| Command | Covers | Needs backend |
|---|---|---|
| `npm run verify:client` | Error routing, SSE parsing, math rendering, context window | No |
| `npm run verify:server` | API contract (routes / auth / CORS / error codes / streaming telemetry), loading-phase behavior, polling policy | Yes |

`verify:server` needs `7.api_myriad_server.py`. It looks in the parent directory by default, or take a path from the environment:

```bash
MYRIAD_SERVER=/path/to/7.api_myriad_server.py npm run verify:server
```

It **skips gracefully** with an explanation (exit 0) when not found, so `npm run verify` won't fail on a standalone clone. It also needs `fastapi` and `torch` — run it in a Python env with the backend deps installed.

Stack: React 19 + TypeScript + Vite 8 + Tailwind CSS 4. KaTeX and fonts are **local dependencies**, no CDN required (works on intranets).

---

## ⚖️ License

This project is **[Apache-2.0](LICENSE)**, matching the backend
[Myriad-MoE-25K-Micro-Experts](https://github.com/aifeifei798/Myriad-MoE-25K-Micro-Experts).
Academic and commercial use allowed; please keep the original attribution when reposting or deriving.

## 📖 Citation

```bibtex
@misc{feifei2026myriadconsole,
  author  = {FeiFei (aifeifei798)},
  title   = {{Myriad-MoE Neural Console: A Web Client for the 25,200 Micro-Expert Dual-Core MoE}},
  year    = {2026},
  publisher = {GitHub},
  howpublished = {\url{https://github.com/aifeifei798/myriad-moe-console}}
}
```
