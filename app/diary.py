"""日记页：从日记仓库（默认 ellllapie/zhangxiaoke-memory）读 memories/daily/。

目录里两种写法都认：
  memories/daily/2026-09-21.md、2026-09-21-evening.md   （一天一篇 / 按时段）
  memories/daily/2026-09-29/13-1346.md                   （一天一个文件夹，每次醒来一篇）
只读，不写。令牌和备份用同一把。
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
PREFIX = "memories/daily/"

PART_NAMES = {
    "morning": "早上", "noon": "中午", "afternoon": "下午", "evening": "晚上",
    "night": "深夜", "handoff": "交接", "late": "深夜", "dawn": "凌晨",
}
FLAT = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:-(.+))?\.md$")
NESTED = re.compile(r"^(\d{4}-\d{2}-\d{2})/(.+)\.md$")
SEQ_TIME = re.compile(r"^(?:\d+-)?(\d{2})(\d{2})$")
NOTES_PATH = os.environ.get("NOTES_PATH", "memories/home/notes.md")
NOTE_HEAD = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?:\s*[·・|—-]\s*(.+?))?\s*$")


class Diary:
    def __init__(self, token_fn):
        self._token = token_fn
        self.repo = os.environ.get("DIARY_REPO") or os.environ.get("BACKUP_REPO", "ellllapie/zhangxiaoke-memory")
        self._tree: tuple[float, list[dict]] | None = None
        self._files: dict[str, str] = {}  # sha -> 正文
        self._notes: tuple[float, list[dict]] | None = None

    def _get(self, url: str, raw: bool = False):
        token = self._token()
        if not token:
            raise RuntimeError("没有能读日记仓库的令牌")
        r = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json",
            "User-Agent": "zhangxiaoke-home",
        })
        with urllib.request.urlopen(r, timeout=30) as resp:
            body = resp.read()
        return body.decode("utf-8", "replace") if raw else json.loads(body or b"{}")

    @staticmethod
    def _label(rest: str | None, nested: bool) -> tuple[str, str]:
        """返回 (显示的名字, 排序键)。"""
        if rest is None:
            return "这一天", "0"
        if nested:
            m = SEQ_TIME.match(rest)
            if m:
                return f"{m.group(1)}:{m.group(2)}", f"1{m.group(1)}{m.group(2)}"
            return rest, "2" + rest
        order = ["dawn", "morning", "noon", "afternoon", "evening", "night", "late", "handoff"]
        if rest in PART_NAMES:
            return PART_NAMES[rest], f"1{order.index(rest):02d}"
        return rest, "2" + rest

    def list(self, force: bool = False) -> list[dict]:
        """按日期分组，新的在前：[{date, entries:[{path, label}]}]"""
        if self._tree and not force and time.time() - self._tree[0] < 120:
            return self._tree[1]
        data = self._get(f"{API}/repos/{self.repo}/git/trees/HEAD?recursive=1")
        days: dict[str, list[tuple[str, dict]]] = {}
        for it in data.get("tree", []):
            p = it.get("path", "")
            if it.get("type") != "blob" or not p.startswith(PREFIX):
                continue
            rel = p[len(PREFIX):]
            m = NESTED.match(rel)
            if m:
                date, (label, key) = m.group(1), self._label(m.group(2), True)
            else:
                m = FLAT.match(rel)
                if not m:
                    continue
                date, (label, key) = m.group(1), self._label(m.group(2), False)
            days.setdefault(date, []).append((key, {"path": p, "label": label, "sha": it.get("sha"), "size": it.get("size")}))
        out = [{"date": d, "entries": [e for _, e in sorted(v, key=lambda x: x[0])]}
               for d, v in sorted(days.items(), reverse=True)]
        self._tree = (time.time(), out)
        return out

    def read(self, path: str) -> dict:
        if not path.startswith(PREFIX) or ".." in path or not path.endswith(".md"):
            raise ValueError("只能读日记目录里的 .md")
        sha = None
        if self._tree:
            for d in self._tree[1]:
                for e in d["entries"]:
                    if e["path"] == path:
                        sha = e["sha"]
        if sha and sha in self._files:
            return {"path": path, "text": self._files[sha]}
        q = urllib.parse.quote(path)
        try:
            text = self._get(f"{API}/repos/{self.repo}/contents/{q}", raw=True)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise FileNotFoundError(path)
            raise
        if sha:
            self._files[sha] = text
        return {"path": path, "text": text}

    # ── 留言条 ──
    # memories/home/notes.md，每条一段：
    #   ## 2026-09-29 14:51 · claude.ai
    #   想说的话（可以多行）
    # 新的写在最上面；顺序乱了也没关系，这里按时间排。
    def notes(self, force: bool = False) -> list[dict]:
        if self._notes and not force and time.time() - self._notes[0] < 60:
            return self._notes[1]
        try:
            text = self._get(f"{API}/repos/{self.repo}/contents/{urllib.parse.quote(NOTES_PATH)}", raw=True)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            text = ""
        out, cur = [], None
        for line in text.splitlines():
            m = NOTE_HEAD.match(line.strip())
            if m:
                cur = {"date": m.group(1), "time": m.group(2).zfill(5), "from": (m.group(3) or "").strip(), "lines": []}
                out.append(cur)
            elif cur is not None:
                cur["lines"].append(line)
        for n in out:
            n["text"] = "\n".join(n.pop("lines")).strip()
            n["id"] = f"{n['date']} {n['time']}"
        out = [n for n in out if n["text"]]
        out.sort(key=lambda n: n["id"], reverse=True)
        out = out[:30]
        self._notes = (time.time(), out)
        return out

    def latest(self) -> dict | None:
        """最新一篇日记 + 开头几句。"""
        days = self.list()
        if not days:
            return None
        d = days[0]
        e = d["entries"][-1]
        text = self.read(e["path"])["text"]
        title, body = "", []
        for line in text.splitlines():
            t = line.strip()
            if not t:
                continue
            if t.startswith("#"):
                if not title:
                    title = t.lstrip("#").strip()
                continue
            body.append(t.lstrip("-* ").strip())
            if sum(len(b) for b in body) > 160:
                break
        excerpt = " ".join(body)
        if len(excerpt) > 150:
            excerpt = excerpt[:150] + "…"
        return {"date": d["date"], "label": e["label"], "path": e["path"], "title": title, "excerpt": excerpt}
