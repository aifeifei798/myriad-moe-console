"""
验证「引擎未就绪时客户端不再轮询 stats」。
起两个真实 uvicorn：
  A) 永远卡在加载中  → 期望 stats 请求数为 0
  B) 就绪             → 期望 stats 请求数 > 0
用真实 HTTP 请求模拟客户端的轮询循环。
"""
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = Path(os.environ.get("MYRIAD_SERVER") or (REPO / "7.api_myriad_server.py"))
if not BACKEND.exists():
    print("\n[跳过] 未找到后端 7.api_myriad_server.py（服务端契约测试需要它）")
    sys.exit(0)

TEMPLATE = r'''
import importlib.util
spec = importlib.util.spec_from_file_location("srv", %r)
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

%s

import uvicorn
uvicorn.run(srv.app, host="127.0.0.1", port=%d, log_level="warning")
'''

LOADING_ENGINE = '''
class StubEngine:
    ready = False
    startup_error = None
    model_id = "Qwen/Qwen3-0.6B"
    num_clusters = 20
    def load(self):
        return None
    def __getattr__(self, name):
        raise AttributeError(name)

srv.engine = StubEngine()
'''

READY_ENGINE = '''
import types, torch

class StubMlp:
    def __init__(self):
        self.top_k = 2
        self.stat_cluster_counts = torch.zeros(20, dtype=torch.int32)
        self.stat_arts_weight = torch.tensor([62.0])
        self.stat_sci_weight = torch.tensor([38.0])

class StubLayer:
    def __init__(self):
        self.mlp = StubMlp()

class StubEngine:
    ready = True
    startup_error = None
    model_id = "Qwen/Qwen3-0.6B"
    num_clusters = 20
    experts_per_cluster = 45
    _caged = {}
    _plugged = {}
    _slot_holder = None
    args = types.SimpleNamespace(api_key=None, max_len=512)
    layers = [StubLayer() for _ in range(28)]
    gate = types.SimpleNamespace(locked=lambda: False)
    decoder = types.SimpleNamespace(enabled=True, cache_len=0)
    def load(self):
        return None
    def dashboard(self):
        return {"model": "m", "base_model": "b", "layers": 28, "clusters": 20,
                "experts_per_cluster": 45, "total_experts": 25200,
                "arts_core_pct": 62.0, "sci_core_pct": 38.0, "cuda_graph": True,
                "cache_bucket_tokens": 0, "slot_state": "idle", "slot_holder": None,
                "caged_clusters": [], "caged_layer_map": {}, "plugged_cartridges": {},
                "top_clusters": [], "per_cluster": [], "per_layer": [],
                "vram": {}, "metrics": srv.Metrics().snapshot()}

srv.engine = StubEngine()
'''

PORT_LOADING = 8941
PORT_READY = 8942


def start(port: int, engine_src: str) -> subprocess.Popen:
    code = TEMPLATE % (str(BACKEND), engine_src, port)
    p = subprocess.Popen(
        [str(REPO / ".venv/bin/python3"), "-c", code],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(80):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1).read()
            return p
        except Exception:
            time.sleep(0.25)
    p.kill()
    raise RuntimeError(f"server on {port} did not start")


def get(url: str):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def probe_loop(port: int, rounds: int = 4, interval: float = 1.2) -> dict:
    """复刻客户端行为：每轮先查 /v1/models 判就绪，再决定是否拉 stats。"""
    base = f"http://127.0.0.1:{port}"
    stats_calls = 0
    models_calls = 0
    for _ in range(rounds):
        code, text = get(f"{base}/v1/models")
        models_calls += 1
        ready = False
        if code == 200:
            try:
                ready = json.loads(text)["data"][0]["myriad"]["layers"] is not None
            except Exception:
                ready = False
        if ready:
            stats_calls += 1
            get(f"{base}/v1/myriad/stats")
        time.sleep(interval)
    return {"models": models_calls, "stats": stats_calls}


def main() -> int:
    p1 = p2 = None
    try:
        print("\n[A] 引擎卡在加载中")
        p1 = start(PORT_LOADING, LOADING_ENGINE)
        r = probe_loop(PORT_LOADING)
        print(f"  /v1/models 请求 {r['models']} 次 (就绪探测，必须继续)")
        print(f"  /v1/myriad/stats 请求 {r['stats']} 次 (应为 0)")
        a_ok = r["stats"] == 0 and r["models"] > 0
        print(f"  {'✓' if a_ok else '✗'} 未就绪时完全不轮询 stats")

        print("\n[B] 引擎已就绪")
        p2 = start(PORT_READY, READY_ENGINE)
        r2 = probe_loop(PORT_READY)
        print(f"  /v1/models 请求 {r2['models']} 次")
        print(f"  /v1/myriad/stats 请求 {r2['stats']} 次 (应 > 0)")
        b_ok = r2["stats"] == r2["models"] and r2["stats"] > 0
        print(f"  {'✓' if b_ok else '✗'} 就绪后正常轮询 stats")

        code, text = get(f"http://127.0.0.1:{PORT_READY}/v1/myriad/stats")
        try:
            payload = json.loads(text)
        except Exception:
            payload = {}
        c_ok = code == 200 and payload.get("total_experts") == 25200 and payload.get("layers") == 28
        print(f"  {'✓' if c_ok else '✗'} 就绪端 stats 返回 200 且数据正确 "
              f"(code={code}, total_experts={payload.get('total_experts')!r})")

        ok = a_ok and b_ok and c_ok
        print("\n结果:", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        for p in (p1, p2):
            if p:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()


if __name__ == "__main__":
    sys.exit(main())