"""把家里的东西备份到外面：私有 GitHub 仓库（默认就是日记仓库）的 home-backup/ 目录。

备份什么：data/ 下的状态文件、主题等，以及 Claude Code 的会话记录（聊天全文）。
不备份：.env、config/（里面有密码和令牌）。
只传有改动的文件；聊完一轮后一分钟内推一次，另外每六小时兜底一次。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from claude_agent_sdk import project_key_for_directory

API = "https://api.github.com"


class Backup:
    def __init__(self, root: Path, data: Path, workdir: Path, config: Path):
        self.root, self.data, self.workdir, self.config = root, data, workdir, config
        self.repo = os.environ.get("BACKUP_REPO", "ellllapie/zhangxiaoke-memory")
        self.prefix = os.environ.get("BACKUP_PREFIX", "home-backup").strip("/")
        self.index_file = data / "backup_index.json"
        self._pending: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.last = {"at": None, "uploaded": 0, "error": None}

    # ── 令牌：优先 BACKUP_TOKEN，否则借 mcp.json 里 github 那把 ──
    def _token(self) -> str | None:
        t = os.environ.get("BACKUP_TOKEN")
        if t:
            return t
        try:
            d = json.loads((self.config / "mcp.json").read_text(encoding="utf-8"))
            s = d.get("mcpServers", d)
            auth = s["github"]["headers"]["Authorization"]
            return auth.split(" ", 1)[1].strip()
        except Exception:
            return None

    def sessions_dir(self) -> Path:
        return Path.home() / ".claude" / "projects" / project_key_for_directory(str(self.workdir))

    def _files(self) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for p in self.data.rglob("*"):
            if p.is_file() and p.name not in {"backup_index.json"} and not p.name.endswith(".tmp"):
                out[f"data/{p.relative_to(self.data).as_posix()}"] = p
        sd = self.sessions_dir()
        if sd.exists():
            for p in sd.rglob("*.jsonl"):
                out[f"sessions/{p.relative_to(sd).as_posix()}"] = p
        return out

    def _load_index(self) -> dict:
        try:
            return json.loads(self.index_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _req(self, method: str, url: str, token: str, body: dict | None = None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "zhangxiaoke-home",
        })
        with urllib.request.urlopen(r, timeout=60) as resp:
            return json.loads(resp.read() or b"{}")

    def _remote_sha(self, token: str, path: str) -> str | None:
        try:
            return self._req("GET", f"{API}/repos/{self.repo}/contents/{path}", token).get("sha")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def run_sync(self) -> dict:
        token = self._token()
        if not token:
            self.last = {"at": time.time(), "uploaded": 0, "error": "没有可用的令牌"}
            return self.last
        index = self._load_index()
        uploaded, errors = 0, []
        for rel, p in sorted(self._files().items()):
            try:
                raw = p.read_bytes()
            except OSError:
                continue
            h = hashlib.sha256(raw).hexdigest()
            entry = index.get(rel, {})
            if entry.get("hash") == h:
                continue
            path = f"{self.prefix}/{rel}"
            body = {"message": f"备份 {rel}", "content": base64.b64encode(raw).decode()}
            sha = entry.get("sha")
            for attempt in (1, 2):
                if sha:
                    body["sha"] = sha
                try:
                    res = self._req("PUT", f"{API}/repos/{self.repo}/contents/{path}", token, body)
                    index[rel] = {"hash": h, "sha": res["content"]["sha"]}
                    uploaded += 1
                    break
                except urllib.error.HTTPError as e:
                    if attempt == 1 and e.code in (409, 422):
                        sha = self._remote_sha(token, path)  # 记录的 sha 过期了，重新拿
                        continue
                    errors.append(f"{rel}: HTTP {e.code}")
                    break
                except Exception as e:
                    errors.append(f"{rel}: {e}")
                    break
        tmp = self.index_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.index_file)
        self.last = {"at": time.time(), "uploaded": uploaded, "error": "; ".join(errors) or None}
        if uploaded or errors:
            print(f"[backup] 上传 {uploaded} 个文件" + (f"，出错：{self.last['error']}" if errors else ""))
        return self.last

    async def run(self) -> dict:
        async with self._lock:
            return await asyncio.to_thread(self.run_sync)

    def soon(self, delay: float = 60) -> None:
        """聊完一轮后调用：一分钟内没有新的一轮就推一次。"""
        if self._pending and not self._pending.done():
            self._pending.cancel()

        async def later():
            await asyncio.sleep(delay)
            await self.run()

        self._pending = asyncio.create_task(later())

    async def loop(self, every: float = 6 * 3600) -> None:
        await asyncio.sleep(30)
        while True:
            try:
                await self.run()
            except Exception as e:
                print(f"[backup] {e}")
            await asyncio.sleep(every)
