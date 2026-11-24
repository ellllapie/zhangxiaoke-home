"""旧书架：claude.ai 上导回来的旧对话（11-21 导的 132 篇），一篇一个 txt，只读。

文件格式：第一行「# 标题」，第二行开始时间，然后一段段
「===== Ella · 时间 =====」/「===== Claude · 时间 =====」后面跟原话。
目录用 .env 的 CLAUDE_ARCHIVE_DIR 改，默认 /home/admin/claude-archive/raw。
读过的按文件修改时间缓存，文件不变就不重读。聊天里贴过的 key / token 照 Kelivo 那样打码。
"""
import os
import re
import threading
from datetime import datetime
from pathlib import Path

from app.kelivo import redact


def to_ms(s):
    try:
        return int(datetime.fromisoformat(s.strip().replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, AttributeError):
        return 0


HEAD = re.compile(r"^===== (Ella|Claude) · (\S+) =====\s*$", re.M)


class OldChats:
    def __init__(self):
        self.dir = Path(os.environ.get("CLAUDE_ARCHIVE_DIR") or "/home/admin/claude-archive/raw")
        self._cache: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _files(self):
        if not self.dir.is_dir():
            return []
        return sorted(p for p in self.dir.glob("*.txt") if p.is_file())

    def _parse(self, p: Path) -> dict:
        mt = p.stat().st_mtime
        with self._lock:
            hit = self._cache.get(p.name)
            if hit and hit[0] == mt:
                return hit[1]
        raw = p.read_text("utf-8", errors="replace")
        lines = raw.split("\n", 2)
        title = lines[0].lstrip("# ").strip() if lines and lines[0].startswith("#") else p.stem
        heads = list(HEAD.finditer(raw))
        msgs = []
        for i, m in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(raw)
            text = redact(raw[m.end():end].strip("\n").strip())
            msgs.append({"role": "user" if m.group(1) == "Ella" else "assistant",
                         "ts": to_ms(m.group(2)) or 0, "text": text})
        start = msgs[0]["ts"] if msgs else (to_ms(lines[1].strip()) if len(lines) > 1 else 0) or 0
        d = {"id": p.stem, "title": title, "start": start,
             "end": msgs[-1]["ts"] if msgs else start, "n": len(msgs), "msgs": msgs}
        with self._lock:
            self._cache[p.name] = (mt, d)
        return d

    def list(self, q: str = ""):
        q = (q or "").strip().lower()
        out = []
        for p in self._files():
            d = self._parse(p)
            hit = None
            if q:
                if q in d["title"].lower():
                    hit = ""
                else:
                    for m in d["msgs"]:
                        k = m["text"].lower().find(q)
                        if k >= 0:
                            hit = m["text"][max(0, k - 20):k + 40].replace("\n", " ")
                            break
                if hit is None:
                    continue
            out.append({"id": d["id"], "title": d["title"], "start": d["start"], "end": d["end"],
                        "n": d["n"], **({"hit": hit} if hit else {})})
        out.sort(key=lambda c: c["start"])
        return out

    def read(self, cid: str):
        # 只认目录里真有的文件名，不拼路径
        for p in self._files():
            if p.stem == cid:
                return self._parse(p)
        return None
