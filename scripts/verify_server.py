"""
用桩引擎启动真实的 7.api_myriad_server.py，验证客户端依赖的服务端行为。
不加载 1.6GB 权重，只校验 API 契约（路由、鉴权、CORS、caged_layer_map、错误码）。
"""
import json
import os
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _backend import require_backend  # noqa: E402

BACKEND = require_backend()
sys.path.insert(0, str(BACKEND.parent))

import importlib.util

import torch

spec = importlib.util.spec_from_file_location("srv", BACKEND)
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

# ── 构造一个形状与真实引擎一致的桩 ──
N_LAYERS, N_CLUSTERS, N_EXPERTS = 28, 20, 45


class StubMlp:
    def __init__(self, top_k, num_clusters):
        self.top_k = top_k
        # /catch 与 dashboard 会读取这些张量
        self.stat_cluster_counts = torch.zeros(num_clusters, dtype=torch.int32)
        self.stat_cluster_counts[3] = 50  # 让第 3 号宗门成为各层主导
        self.stat_arts_weight = torch.tensor([62.0])
        self.stat_sci_weight = torch.tensor([38.0])


class StubLayer:
    def __init__(self, k, num_clusters):
        self.mlp = StubMlp(k, num_clusters)


class StubEngine:
    def __init__(self, api_key=None, read_only_key=None):
        self.ready = True
        self.startup_error = None
        self.num_clusters = N_CLUSTERS
        self.experts_per_cluster = N_EXPERTS
        self.model_id = "Qwen/Qwen3-0.6B"
        self.cluster_names = [f"Cluster_{i:02d}" for i in range(N_CLUSTERS)]
        self._caged = {}
        self._plugged = {}
        self.args = types.SimpleNamespace(api_key=api_key, read_only_key=read_only_key,
                                          max_len=512, max_cartridge_mb=1)
        self.metrics = srv.Metrics()
        self.gate = types.SimpleNamespace(locked=lambda: False)
        self._slot_holder = None
        self.decoder = types.SimpleNamespace(enabled=True, cache_len=128,
                                            invalidate=lambda *_: None)
        self.layers = [StubLayer(2, N_CLUSTERS) for _ in range(N_LAYERS)]

    def dashboard(self):
        # 复用真实实现，但需要真实 layer 属性；这里手工构造等价结构
        arts, sci = 62.0, 38.0
        per_cluster = [
            {"id": c, "name": self.cluster_names[c], "hits": 100 * (c + 1),
             "caged": bool(c in self._caged),
             "cartridge": self._plugged.get(c, {}).get("name")}
            for c in range(self.num_clusters)
        ]
        per_layer = [
            {"layer": i, "top_k": self.layers[i].mlp.top_k,
             "active_experts": self.layers[i].mlp.top_k * self.experts_per_cluster,
             "dominant_cluster": 3, "dominant_name": self.cluster_names[3],
             "activations": 50}
            for i in range(N_LAYERS)
        ]
        return {
            "model": srv.SERVED_MODEL_ID, "base_model": self.model_id,
            "layers": len(self.layers), "clusters": self.num_clusters,
            "experts_per_cluster": self.experts_per_cluster,
            "total_experts": len(self.layers) * self.num_clusters * self.experts_per_cluster,
            "arts_core_pct": arts, "sci_core_pct": sci,
            "top_clusters": [{"id": 0, "name": "Cluster_00", "hits": 100, "slot": False, "caged": False}],
            "per_cluster": per_cluster, "per_layer": per_layer,
            "cuda_graph": True, "cache_bucket_tokens": 128,
            "slot_state": "idle", "slot_holder": None,
            "caged_clusters": sorted(self._caged.keys()),
            "caged_layer_map": {str(c): sorted(d.keys()) for c, d in self._caged.items()},
            "plugged_cartridges": {str(k): v for k, v in self._plugged.items()},
            "vram": {"allocated_mb": 1234.5, "peak_allocated_mb": 2000.0, "reserved_mb": 3000.0},
            "metrics": self.metrics.snapshot(),
        }

    def _check_cluster(self, cid):
        if not (0 <= int(cid) < self.num_clusters):
            raise ValueError(f"宗门编号需在 0 ~ {self.num_clusters - 1} 之间")

    def cage(self, cid):
        self._check_cluster(cid)
        if cid in self._caged:
            raise ValueError(f"宗门 #{cid:02d} 已在禁闭室")
        self._caged[cid] = {i: None for i in range(len(self.layers))}
        return {"cluster": cid, "name": self.cluster_names[cid], "caged_layers": len(self.layers)}

    def free(self, cid, layer=None):
        self._check_cluster(cid)
        if cid not in self._caged:
            raise ValueError(f"宗门 #{cid:02d} 并未被关押")
        stash = self._caged[cid]
        if layer is None:
            released = sorted(stash.keys())
            del self._caged[cid]
            return {"cluster": cid, "name": self.cluster_names[cid],
                    "released_layers": released, "fully_released": True,
                    "still_caged_layers": []}
        layer = int(layer)
        if not (0 <= layer < len(self.layers)):
            raise ValueError(f"层号需在 0 ~ {len(self.layers) - 1} 之间")
        if layer not in stash:
            raise ValueError(f"宗门 #{cid:02d} 在第 {layer} 层并未被封杀")
        stash.pop(layer)
        fully = not stash
        if fully:
            del self._caged[cid]
        return {"cluster": cid, "name": self.cluster_names[cid],
                "released_layers": [layer], "fully_released": fully,
                "still_caged_layers": sorted(stash.keys())}

    def snipe(self, layer, cid):
        self._check_cluster(cid)
        if not (0 <= layer < len(self.layers)):
            raise ValueError(f"层号需在 0 ~ {len(self.layers) - 1} 之间")
        self._caged.setdefault(cid, {}).setdefault(layer, None)
        return {"layer": layer, "cluster": cid, "name": self.cluster_names[cid]}

    def set_top_k(self, layer, k):
        k = max(1, min(int(k), srv.MAX_TOP_K))
        if layer is None:
            for l in self.layers:
                l.mlp.top_k = k
            return {"scope": "all", "k": k, "active_experts_per_step": k * self.experts_per_cluster * len(self.layers)}
        if not (0 <= layer < len(self.layers)):
            raise ValueError(f"层号需在 0 ~ {len(self.layers) - 1} 之间")
        self.layers[layer].mlp.top_k = k
        return {"scope": "layer", "layer": layer, "k": k}

    def set_engine(self, enabled=None, max_len=None):
        if enabled is not None:
            self.decoder.enabled = bool(enabled)
        if max_len is not None:
            self.args.max_len = max(64, min(int(max_len), 8192))
        return {"cuda_graph": bool(self.decoder.enabled), "max_len": self.args.max_len}

    def reset_stats(self):
        pass

    def plug_cartridge(self, cartridge, slot=16, source=None):
        self._check_cluster(slot)
        if isinstance(cartridge, (str, os.PathLike)):
            if not os.path.exists(cartridge):
                raise FileNotFoundError(f"找不到卡带: {cartridge}")
            name = str(cartridge)
        else:
            name = source or "uploaded.pt"
        self._plugged[slot] = {"name": name, "source": source or name,
                               "plugged_ms": 1.0, "at": "2026-01-01 00:00:00"}
        self._caged.pop(slot, None)
        return {"slot": slot, "name": name, "elapsed_ms": 1.0}

    def encode_prompt(self, messages, chat_template_kwargs=None):
        return torch.tensor([[1, 2, 3]])

    async def stream(self, input_ids, params, focus_clusters=None,
                     top_k_override=None, reset_stats=False, slot_tag="-"):
        """最小可用的流式桩：吐两个 delta 再给 final。"""
        yield {"t": "delta", "reasoning": "思考", "content": ""}
        for piece in ("你", "好"):
            yield {"t": "delta", "reasoning": "", "content": piece}
        yield {"t": "final", "finish_reason": "stop", "content": "你好",
               "reasoning": "思考", "prompt_tokens": 7, "completion_tokens": 2,
               "ttft": 0.01}


PASS, FAIL = 0, 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \u2713 {name}")
    else:
        FAIL += 1
        print(f"  \u2717 {name} {extra}")


def main():
    from fastapi.testclient import TestClient

    print("\n[A] 无鉴权模式")
    srv.engine = StubEngine(api_key=None)
    c = TestClient(srv.app, raise_server_exceptions=False)

    r = c.get("/v1/models")
    check("GET /v1/models 返回 200 (客户端连通性探测目标)", r.status_code == 200, r.text[:200])
    check("返回模型 id 与 SERVED_MODEL_ID 一致", r.json()["data"][0]["id"] == srv.SERVED_MODEL_ID)

    r = c.get("/v1/myriad/stats")
    check("GET /v1/myriad/stats 返回 200", r.status_code == 200, r.text[:200])
    d = r.json()
    check("统计含 layers / clusters / experts_per_cluster", d.get("layers") == 28 and d.get("experts_per_cluster") == 45)
    check("统计含 caged_layer_map (客户端新增依赖)", "caged_layer_map" in d)
    check("caged_layer_map 初始为空", d.get("caged_layer_map") == {})
    check("统计含 plugged_cartridges", "plugged_cartridges" in d)

    r = c.get("/v1/myriad/catch")
    check("GET /v1/myriad/catch 返回 200", r.status_code == 200, r.text[:300])
    if r.status_code == 200:
        cd = r.json()
        check("catch 返回 layers 数组", isinstance(cd.get("layers"), list) and len(cd["layers"]) == 28)
        check("catch 层含 dominant_cluster 字段", "dominant_cluster" in cd["layers"][0])

    # 客户端测试连接用的就是 /models
    check("客户端 baseUrl+'/models' 拼接结果与真实路由匹配", c.get("/v1/models").status_code == 200)

    print("\n[B] 鉴权模式：验证 401 会被客户端如实上报")
    srv.engine = StubEngine(api_key="sk-secret")
    c = TestClient(srv.app, raise_server_exceptions=False)
    r = c.get("/v1/models")
    check("无 Authorization 时 /v1/models 返回 401", r.status_code == 401, r.status_code)
    check("401 body 含 detail", "detail" in r.json(), r.text[:200])
    r = c.get("/v1/models", headers={"Authorization": "Bearer wrong"})
    check("错误 key 返回 401", r.status_code == 401)
    r = c.get("/v1/models", headers={"Authorization": "Bearer sk-secret"})
    check("正确 key 返回 200", r.status_code == 200)

    # 客户端发送的 header 形式
    hdrs = {"Authorization": f"Bearer {'sk-secret'}"}
    check("客户端 Bearer 头格式被服务端接受", c.get("/v1/models", headers=hdrs).status_code == 200)

    print("\n[C] 神经手术端点")
    srv.engine = StubEngine(api_key=None)
    c = TestClient(srv.app, raise_server_exceptions=False)

    r = c.post("/v1/myriad/clusters/16/cage")
    check("cage 返回 200", r.status_code == 200, r.text[:200])
    d = c.get("/v1/myriad/stats").json()
    check("cage 后 caged_clusters 含 16", 16 in d["caged_clusters"], d["caged_clusters"])
    check("全局禁闭 → caged_layer_map['16'] 长度为 layers", len(d["caged_layer_map"]["16"]) == 28,
          len(d.get("caged_layer_map", {}).get("16", [])))

    r = c.post("/v1/myriad/clusters/16/cage")
    check("重复 cage 返回 400 (客户端应如实报错)", r.status_code == 400, r.status_code)
    check("400 body 含中文 detail", "已在禁闭室" in r.json().get("detail", ""), r.text[:200])

    r = c.post("/v1/myriad/snipe", json={"layer": 7, "cluster": 5})
    check("snipe 单层返回 200", r.status_code == 200, r.text[:200])
    d = c.get("/v1/myriad/stats").json()
    check("单层狙击 → caged_layer_map['5'] 只有 [7]",
          d["caged_layer_map"].get("5") == [7], d["caged_layer_map"].get("5"))

    r = c.post("/v1/myriad/snipe", json={"layer": 99, "cluster": 5})
    check("越界层号 snipe 返回 400", r.status_code == 400, r.status_code)

    r = c.post("/v1/myriad/snipe", json={"layer": 1, "cluster": 999})
    check("越界宗门 snipe 返回 400", r.status_code == 400, r.status_code)

    r = c.post("/v1/myriad/clusters/5/free")
    check("free 返回 200", r.status_code == 200, r.text[:200])
    d = c.get("/v1/myriad/stats").json()
    check("free 后 caged_layer_map['5'] 整体消失", "5" not in d["caged_layer_map"], d["caged_layer_map"].keys())

    r = c.post("/v1/myriad/clusters/9/free")
    check("释放未关押宗门返回 400", r.status_code == 400, r.status_code)

    r = c.post("/v1/myriad/topk", json={"k": 5, "layer": None})
    check("全局 set_topk 返回 200", r.status_code == 200, r.text[:200])
    r = c.post("/v1/myriad/topk", json={"k": 99, "layer": None})
    check("超范围 k 被 clamp 而非报错", r.status_code == 200 and r.json()["k"] == 10, r.text[:200])

    r = c.post("/v1/myriad/engine", json={"cuda_graph": False})
    check("engine 切换返回 200", r.status_code == 200, r.text[:200])

    print("\n[C2] 单层狙击单点解封（本次新增）")
    # 先全局禁闭 16，再对它打三发狙击
    c.post("/v1/myriad/clusters/16/cage")
    for lay in (3, 7, 11):
        c.post("/v1/myriad/snipe", json={"layer": lay, "cluster": 16})
    d = c.get("/v1/myriad/stats").json()
    # 全局 cage 已写入全部 28 层，后续 snipe 的 setdefault 不会覆盖
    check("全局禁闭后层集合为全部 28 层", len(d["caged_layer_map"]["16"]) == 28,
          len(d["caged_layer_map"]["16"]))

    # 换个只被狙击过的宗门
    for lay in (5, 9):
        c.post("/v1/myriad/snipe", json={"layer": lay, "cluster": 6})
    d = c.get("/v1/myriad/stats").json()
    check("6 号宗门只记录被狙击的层", d["caged_layer_map"]["6"] == [5, 9], d["caged_layer_map"].get("6"))

    r = c.post("/v1/myriad/clusters/6/free", params={"layer": 9})
    check("单层解封返回 200", r.status_code == 200, r.text[:300])
    body = r.json()
    check("object 标记为 layer_freed", body.get("object") == "myriad.cluster.layer_freed", body.get("object"))
    check("released_layers 只含被解封层", body.get("released_layers") == [9], body.get("released_layers"))
    check("fully_released=False（仍有其他层封杀）", body.get("fully_released") is False, body.get("fully_released"))
    check("still_caged_layers 保留 [5]", body.get("still_caged_layers") == [5], body.get("still_caged_layers"))

    d = c.get("/v1/myriad/stats").json()
    check("统计里 6 号只剩第 5 层", d["caged_layer_map"]["6"] == [5], d["caged_layer_map"].get("6"))
    check("6 号仍在禁闭名单中", 6 in d["caged_clusters"], d["caged_clusters"])

    r = c.post("/v1/myriad/clusters/6/free", params={"layer": 5})
    check("解封最后一层返回 200", r.status_code == 200)
    check("最后一层 fully_released=True", r.json().get("fully_released") is True)
    check("still_caged_layers 为空", r.json().get("still_caged_layers") == [])
    d = c.get("/v1/myriad/stats").json()
    check("全部解封后从名单消失", "6" not in d["caged_clusters"], d["caged_clusters"])
    check("caged_layer_map 中也消失", "6" not in d["caged_layer_map"])

    # 错误路径
    r = c.post("/v1/myriad/clusters/6/free", params={"layer": 5})
    check("对未封杀宗门单层解封返回 400", r.status_code == 400, r.status_code)
    r = c.post("/v1/myriad/clusters/16/free", params={"layer": 999})
    check("越界层号返回 400", r.status_code == 400, r.status_code)

    # 向后兼容：不带 layer 仍是整宗释放
    c.post("/v1/myriad/clusters/3/cage")
    r = c.post("/v1/myriad/clusters/3/free")
    check("不带 layer 仍整宗释放", r.status_code == 200 and r.json()["object"] == "myriad.cluster.freed",
          r.text[:200])
    check("整宗释放 fully_released=True", r.json().get("fully_released") is True)

    print("\n[D] 斜杠指令短路为 JSON（客户端依赖此行为）")
    r = c.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "/stats"}]})
    check("/stats 返回 JSON 而非 SSE", r.status_code == 200, r.status_code)
    check("Content-Type 为 application/json", "application/json" in r.headers.get("content-type", ""))
    body = r.json()
    check("myriad.command_dispatched = True", body.get("myriad", {}).get("command_dispatched") is True, body.get("myriad"))
    check("choices[0].message.content 非空", bool(body["choices"][0]["message"]["content"]))

    r = c.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "/help"}]})
    check("/help 同样短路为 JSON", "application/json" in r.headers.get("content-type", ""))

    print("\n[E] 模型未就绪 → 503（客户端不得兜底成假数据）")
    srv.engine.ready = False
    srv.engine.startup_error = "RuntimeError: CUDA out of memory"
    r = c.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "hi"}]})
    check("未就绪时 chat 返回 503", r.status_code == 503, r.status_code)
    check("503 detail 含 startup_error", "CUDA out of memory" in r.json().get("detail", ""), r.text[:200])
    srv.engine.ready = True
    srv.engine.startup_error = None

    print("\n[E2] 加载期（ready=False, model=None）不得抛 500")
    # 复现用户报告的崩溃：权重加载期间 self.model 仍是 None
    srv.engine.ready = False
    srv.engine.model = None            # 关键：模拟 load() 尚未完成
    guarded = [
        ("GET", "/v1/myriad/stats", None),
        ("GET", "/v1/myriad/catch", None),
        ("GET", "/v1/myriad/clusters", None),
        ("GET", "/v1/myriad/topk", None),
        ("GET", "/v1/myriad/metrics", None),
        ("POST", "/v1/myriad/stats/reset", None),
        ("POST", "/v1/myriad/topk", {"k": 2, "layer": None}),
        ("POST", "/v1/myriad/clusters/3/cage", None),
        ("POST", "/v1/myriad/clusters/3/free", None),
        ("POST", "/v1/myriad/snipe", {"layer": 1, "cluster": 2}),
        ("POST", "/v1/myriad/engine", {"cuda_graph": False}),
    ]
    for method, path, body in guarded:
        rr = c.request(method, path, json=body) if body else c.request(method, path)
        check(f"{method} {path} 返回 503 而非 500", rr.status_code == 503,
              f"got {rr.status_code}: {rr.text[:160]}")
    rr = c.post("/v1/myriad/cartridge/plug", data={"path": "x.pt", "slot": "16"})
    check("POST /v1/myriad/cartridge/plug 返回 503 而非 500", rr.status_code == 503,
          f"got {rr.status_code}: {rr.text[:160]}")

    rr = c.get("/v1/myriad/stats")
    check("503 detail 说明是加载中", "加载" in rr.json().get("detail", ""), rr.text[:200])

    # 探测端点必须仍可用，否则客户端无法感知就绪状态
    rr = c.get("/v1/models")
    check("加载期 /v1/models 仍返回 200", rr.status_code == 200, rr.status_code)
    check("未就绪时 myriad.layers 为 null（客户端据此判断 loading）",
          rr.json()["data"][0]["myriad"]["layers"] is None, rr.json()["data"][0]["myriad"])
    rr = c.get("/health")
    check("加载期 /health 仍返回 200", rr.status_code == 200)
    check("/health status=loading", rr.json().get("status") == "loading", rr.json())

    # 恢复
    srv.engine.ready = True
    srv.engine.model = object()
    rr = c.get("/v1/myriad/stats")
    check("就绪后 /v1/myriad/stats 恢复 200", rr.status_code == 200, rr.status_code)

    print("\n[F] 流式 myriad.stats 遥测（本次新增）")

    def sse_payloads(text):
        out = []
        for line in text.splitlines():
            if line.startswith("data: ") and line[6:].strip() != "[DONE]":
                try:
                    out.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
        return out

    body = {"messages": [{"role": "user", "content": "hi"}], "stream": True,
            "stream_options": {"include_usage": True},
            "myriad": {"stats": True}}
    r = c.post("/v1/chat/completions", json=body)
    check("流式请求返回 200", r.status_code == 200, r.status_code)
    check("Content-Type 为 text/event-stream", "text/event-stream" in r.headers.get("content-type", ""))
    frames = sse_payloads(r.text)
    check("收到多个 SSE 帧", len(frames) >= 4, f"frames={len(frames)}")
    check("以 [DONE] 结尾", r.text.strip().endswith("data: [DONE]"))

    telem_frames = [f for f in frames if "myriad" in f]
    check("存在带 myriad 字段的遥测帧", len(telem_frames) == 1, f"count={len(telem_frames)}")
    if telem_frames:
        tel = telem_frames[0]["myriad"]
        check("遥测含 arts_core_pct", "arts_core_pct" in tel, tel.keys())
        check("遥测含 sci_core_pct", "sci_core_pct" in tel)
        check("遥测含 top_clusters", isinstance(tel.get("top_clusters"), list))
        check("遥测含 cuda_graph", "cuda_graph" in tel)
        check("遥测帧 choices 为空（不干扰标准解析）", telem_frames[0]["choices"] == [])
        check("遥测帧同时带 usage", "usage" in telem_frames[0])

    usage_frames = [f for f in frames if "usage" in f]
    check("usage 帧存在", len(usage_frames) >= 1)
    if usage_frames:
        u = usage_frames[-1]["usage"]
        check("usage 数值正确 (prompt=7, completion=2)",
              u["prompt_tokens"] == 7 and u["completion_tokens"] == 2, u)

    content = "".join(f["choices"][0]["delta"].get("content", "")
                      for f in frames if f.get("choices"))
    check("流式正文拼接正确", content == "你好", repr(content))

    # stats=false 时不应下发遥测帧
    body2 = dict(body)
    body2["myriad"] = {"stats": False}
    r2 = c.post("/v1/chat/completions", json=body2)
    frames2 = sse_payloads(r2.text)
    check("stats=false 时无 myriad 帧", not any("myriad" in f for f in frames2))

    # 不带 myriad 字段时同样不下发
    body3 = {k: v for k, v in body.items() if k != "myriad"}
    r3 = c.post("/v1/chat/completions", json=body3)
    frames3 = sse_payloads(r3.text)
    check("缺省 myriad 时无 myriad 帧", not any("myriad" in f for f in frames3))

    print("\n[H] 权限分级：只读令牌")
    srv.engine = StubEngine(api_key="sk-admin", read_only_key="sk-ro")
    c = TestClient(srv.app, raise_server_exceptions=False)
    AH = {"Authorization": "Bearer sk-admin"}
    RH = {"Authorization": "Bearer sk-ro"}

    # /v1/models 广告权限等级，供客户端禁用写按钮
    m = c.get("/v1/models", headers=RH).json()["data"][0]["myriad"]
    check("只读 token → permission=read", m["permission"] == "read", m["permission"])
    check("只读 token → auth_required=true", m["auth_required"] is True)
    check("read_only_available=true", m["read_only_available"] is True)
    m2 = c.get("/v1/models", headers=AH).json()["data"][0]["myriad"]
    check("管理员 token → permission=admin", m2["permission"] == "admin", m2["permission"])

    # 未开鉴权时为 anonymous
    srv.engine = StubEngine(api_key=None)
    c2 = TestClient(srv.app, raise_server_exceptions=False)
    m3 = c2.get("/v1/models").json()["data"][0]["myriad"]
    check("未开鉴权 → permission=anonymous", m3["permission"] == "anonymous", m3["permission"])
    check("未开鉴权 → auth_required=false", m3["auth_required"] is False)

    # 只读可读
    srv.engine = StubEngine(api_key="sk-admin", read_only_key="sk-ro")
    c = TestClient(srv.app, raise_server_exceptions=False)
    for path in ("/v1/myriad/stats", "/v1/myriad/catch", "/v1/myriad/clusters",
                 "/v1/myriad/topk", "/v1/myriad/metrics", "/v1/models"):
        rr = c.get(path, headers=RH)
        check(f"只读 GET {path} → 200", rr.status_code == 200, rr.status_code)

    # 只读被拒的写操作
    writes = [
        ("POST", "/v1/myriad/topk", {"k": 2, "layer": None}),
        ("POST", "/v1/myriad/clusters/1/cage", None),
        ("POST", "/v1/myriad/clusters/1/free", None),
        ("POST", "/v1/myriad/snipe", {"layer": 1, "cluster": 2}),
        ("POST", "/v1/myriad/engine", {"cuda_graph": False}),
        ("POST", "/v1/myriad/stats/reset", None),
        ("POST", "/v1/chat/completions", {"messages": [{"role": "user", "content": "hi"}]}),
        ("POST", "/v1/completions", {"prompt": "hi"}),
    ]
    for method, path, body in writes:
        rr = c.request(method, path, json=body, headers=RH) if body else c.request(method, path, headers=RH)
        check(f"只读 {method} {path} → 403", rr.status_code == 403,
              f"got {rr.status_code}: {rr.text[:120]}")
    rr = c.post("/v1/myriad/cartridge/plug", data={"path": "x.pt", "slot": "16"}, headers=RH)
    check("只读 plug → 403", rr.status_code == 403, rr.status_code)

    r403 = c.post("/v1/myriad/topk", json={"k": 2, "layer": None}, headers=RH)
    check("403 detail 说明是只读令牌", "只读" in r403.json().get("detail", ""), r403.text[:200])

    # 管理员不被权限拦截（断言「不是 403」而非「200」：
    # 某些端点会因桩引擎能力不足返回别的错误码，与权限无关）
    for method, path, body in writes:
        rr = c.request(method, path, json=body, headers=AH) if body else c.request(method, path, headers=AH)
        check(f"管理员 {method} {path} 不被 403 拦截", rr.status_code != 403,
              f"got {rr.status_code}: {rr.text[:120]}")
    rr = c.post("/v1/myriad/topk", json={"k": 3, "layer": None}, headers=AH)
    check("管理员 topk 实际生效", rr.status_code == 200 and rr.json().get("k") == 3, rr.text[:200])
    rr = c.post("/v1/myriad/clusters/1/cage", headers=AH)
    check("管理员 cage 实际生效", rr.status_code == 200, rr.text[:200])

    # 只配 read-only 而没有 admin key → 所有人都是只读
    srv.engine = StubEngine(api_key=None, read_only_key="sk-ro-only")
    c3 = TestClient(srv.app, raise_server_exceptions=False)
    RO_ONLY = {"Authorization": "Bearer sk-ro-only"}
    check("仅配只读 key：只读 token 可读", c3.get("/v1/myriad/stats", headers=RO_ONLY).status_code == 200)
    check("仅配只读 key：无 token → 401", c3.get("/v1/myriad/stats").status_code == 401)
    check("仅配只读 key：管理员 key 也无效 → 401",
          c3.get("/v1/myriad/stats", headers=AH).status_code == 401)
    check("仅配只读 key：该 key 写操作 → 403",
          c3.post("/v1/myriad/topk", json={"k": 2, "layer": None}, headers=RO_ONLY).status_code == 403)

    print("\n[I] 卡带上传：大小限制与校验")
    srv.engine = StubEngine(api_key=None)   # max_cartridge_mb=1
    c4 = TestClient(srv.app, raise_server_exceptions=False)
    ok_pt = b"\x80\x02" + b"\x00" * 64
    rr = c4.post("/v1/myriad/cartridge/plug",
                 files={"file": ("small.pt", ok_pt, "application/octet-stream")},
                 data={"slot": "16"})
    check("小文件上传 → 200", rr.status_code == 200, rr.text[:200])
    check("返回 object=plugged", rr.json().get("object") == "myriad.cartridge.plugged", rr.text[:200])
    check("返回文件名已净化", rr.json().get("name") == "small.pt", rr.json().get("name"))

    big = b"\x00" * (2 * 1024 * 1024)   # 2MB > 1MB 上限
    rr = c4.post("/v1/myriad/cartridge/plug",
                 files={"file": ("big.pt", big, "application/octet-stream")},
                 data={"slot": "16"})
    check("超大文件 → 413", rr.status_code == 413, f"got {rr.status_code}")
    check("413 detail 说明超限", "上限" in rr.json().get("detail", ""), rr.text[:200])

    rr = c4.post("/v1/myriad/cartridge/plug",
                 files={"file": ("empty.pt", b"", "application/octet-stream")},
                 data={"slot": "16"})
    check("空文件 → 400", rr.status_code == 400, rr.status_code)

    rr = c4.post("/v1/myriad/cartridge/plug", data={"slot": "16"})
    check("既无 file 也无 path → 400", rr.status_code == 400, rr.status_code)

    rr = c4.post("/v1/myriad/cartridge/plug",
                 files={"file": ("a.pt", ok_pt, "application/octet-stream")},
                 data={"slot": "999"})
    check("越界插槽 → 400", rr.status_code == 400, f"got {rr.status_code}")
    check("越界插槽 detail 有说明", "插槽编号" in rr.json().get("detail", ""), rr.text[:200])

    rr = c4.post("/v1/myriad/cartridge/plug", data={"path": "/no/such/file.pt", "slot": "16"})
    check("路径不存在 → 404", rr.status_code == 404, f"got {rr.status_code}")

    print("\n[G] CORS 预检（浏览器直连必需）")
    r = c.options("/v1/chat/completions", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    check("CORS 预检返回 2xx", 200 <= r.status_code < 300, r.status_code)
    check("允许 Authorization 头", "authorization" in r.headers.get("access-control-allow-headers", "").lower(),
          r.headers.get("access-control-allow-headers"))

    print(f"\n结果: {PASS} passed, {FAIL} failed\n")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()