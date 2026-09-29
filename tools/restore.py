"""从备份恢复：把 home-backup/ 里的东西拉回这台机器。

用在新机器上（或者数据丢了的时候）：
    cd ~/zhangxiaoke-home && .venv/bin/python tools/restore.py
先停服务更稳：sudo systemctl stop zhangxiaoke-home，恢复完再 start。
已经存在的文件会被覆盖，覆盖前在旁边留一份 .bak。
"""

import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import os  # noqa: E402

from app.backup import API, Backup  # noqa: E402

workdir = Path(os.environ.get("WORKDIR", str(ROOT / "workspace")))
b = Backup(ROOT, ROOT / "data", workdir, ROOT / "config")
token = b._token()
if not token:
    sys.exit("没有令牌：config/mcp.json 里要有 github 那一条，或者设 BACKUP_TOKEN")

repo_info = b._req("GET", f"{API}/repos/{b.repo}", token)
branch = repo_info["default_branch"]
tree = b._req("GET", f"{API}/repos/{b.repo}/git/trees/{branch}?recursive=1", token)
files = [t for t in tree["tree"] if t["type"] == "blob" and t["path"].startswith(b.prefix + "/")]
if not files:
    sys.exit(f"{b.repo} 里没找到 {b.prefix}/，还没备份过？")

n = 0
for t in files:
    rel = t["path"][len(b.prefix) + 1:]
    if rel.startswith("data/"):
        dest = ROOT / rel
    elif rel.startswith("sessions/"):
        dest = b.sessions_dir() / rel[len("sessions/"):]
    else:
        continue
    blob = b._req("GET", f"{API}/repos/{b.repo}/git/blobs/{t['sha']}", token)
    raw = base64.b64decode(blob["content"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.read_bytes() != raw:
        dest.with_name(dest.name + ".bak").write_bytes(dest.read_bytes())
    dest.write_bytes(raw)
    n += 1
    print("恢复", rel)

# 备份记录作废，下次会按新机器上的文件重新比对
(ROOT / "data" / "backup_index.json").unlink(missing_ok=True)
print(f"完成，恢复了 {n} 个文件。重启：sudo systemctl restart zhangxiaoke-home")
