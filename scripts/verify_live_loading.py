"""以「加载卡住」状态真实起一个 uvicorn，复现并验证用户报告的场景已修复。"""
import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = Path(os.environ.get("MYRIAD_SERVER") or (REPO / "7.api_myriad_server.py"))
if not BACKEND.exists():
    print("\n[跳过] 未找到后端 7.api_myriad_server.py（服务端契约测试需要它）")
    sys.exit(0)

LAUNCHER = r'''
import sys, types, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location("srv", %r)
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

class StubEngine:
    """模拟「权重仍在加载」的引擎：load() 存在但不设置 ready。

    注意不要漏掉 load()：lifespan 会调用它，缺失会被记成 startup_error，
    那样测到的就不是「加载中」而是「加载失败」了。
    """
    ready = False
    startup_error = None
    model_id = "Qwen/Qwen3-0.6B"
    num_clusters = 20

    def load(self):
        # 真实场景下这里要花几十秒加载 1.6GB 权重；桩里直接返回，保持 ready=False
        return None

    def __getattr__(self, name):
        raise AttributeError(f"'StubEngine' object has no attribute {name!r}")

srv.engine = StubEngine()
import uvicorn
uvicorn.run(srv.app, host="127.0.0.1", port=8931, log_level="warning")
''' % str(BACKEND)

proc = subprocess.Popen(
    [str(REPO / ".venv/bin/python3"), "-c", LAUNCHER],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
try:
    # 等待端口起来
    import urllib.request
    import urllib.error
    for _ in range(80):
        try:
            urllib.request.urlopen("http://127.0.0.1:8931/health", timeout=1).read()
            break
        except Exception:
            time.sleep(0.25)
    else:
        print("server did not start\n", proc.stdout.read() if proc.stdout else "")
        sys.exit(1)

    def probe(method, path, body=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:8931{path}",
            method=method,
            data=body.encode() if body else None,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    ok = True
    print("\n[真实 HTTP · 模型卡在加载中]")
    for method, path in [
        ("GET", "/v1/myriad/stats"),
        ("GET", "/v1/myriad/catch"),
        ("GET", "/v1/myriad/topk"),
        ("GET", "/v1/myriad/metrics"),
        ("POST", "/v1/myriad/clusters/3/cage"),
        ("POST", "/v1/myriad/snipe"),
    ]:
        code, text = probe(method, path, "{}" if method == "POST" else None)
        good = code == 503
        ok = ok and good
        print(f"  {'✓' if good else '✗'} {method} {path} → {code}")
        if not good:
            print(f"      {text[:200]}")

    code, text = probe("GET", "/v1/myriad/stats")
    good = "加载" in text
    ok = ok and good
    print(f"  {'✓' if good else '✗'} detail 说明是「加载中」而非崩溃信息")
    print(f"      {text[:140]}")

    code, text = probe("GET", "/v1/models")
    good = code == 200
    ok = ok and good
    print(f"  {'✓' if good else '✗'} GET /v1/models → {code} (客户端就绪探测依赖它)")
    import json as _json
    layers = _json.loads(text)["data"][0]["myriad"]["layers"]
    good = layers is None
    ok = ok and good
    print(f"  {'✓' if good else '✗'} myriad.layers 为 null → 客户端显示「加载中」(得到 {layers!r})")

    code, _ = probe("GET", "/health")
    good = code == 200
    ok = ok and good
    print(f"  {'✓' if good else '✗'} GET /health → {code}")

    print("\n结果:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()