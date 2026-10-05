"""
服务端契约测试的公共前置检查。

本仓库只含前端，服务端文件与 Python 依赖都可能不存在。
找不到时**优雅跳过**（退出码 0），而不是让 npm script 失败。
"""

import os
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
BACKEND_NAME = "7.api_myriad_server.py"


def skip(reason: str, hint: str = "") -> None:
    print(f"\n[跳过] {reason}")
    if hint:
        print(f"       {hint}")
    sys.exit(0)


def require_backend() -> Path:
    """定位后端文件；找不到或 Python 依赖缺失时优雅退出。"""
    backend = Path(os.environ.get("MYRIAD_SERVER") or (REPO_ROOT.parent / BACKEND_NAME))
    if not backend.exists():
        # 再试一次仓库内（部分用户会把后端一起放进来）
        alt = REPO_ROOT / BACKEND_NAME
        if alt.exists():
            backend = alt
        else:
            skip(
                f"未找到后端 {BACKEND_NAME}",
                f"查找位置: {backend}\n"
                f"       本仓库仅含前端。设置 MYRIAD_SERVER=/path/to/{BACKEND_NAME} 后重试。",
            )

    missing = []
    for mod in ("torch", "fastapi"):
        try:
            __import__(mod)
        except Exception:
            missing.append(mod)
    if missing:
        skip(
            f"缺少 Python 依赖: {', '.join(missing)}",
            "服务端契约测试需要后端运行环境；前端测试请用 npm run verify。",
        )

    return backend.resolve()