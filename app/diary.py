"""日记页：从日记仓库（默认 ellllapie/zhangxiaoke-memory）读 memories/daily/。

目录里两种写法都认：
  memories/daily/2026-09-21.md、2026-09-21-evening.md   （一天一篇 / 按时段）
  memories/daily/2026-09-29/13-1346.md                   （一天一个文件夹，每次醒来一篇）
只读，不写。令牌和备份用同一把。
"""

from __future__ import annotations

import base64
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
ELLA_NOTES_PATH = os.environ.get("ELLA_NOTES_PATH", "memories/home/ella-notes.md")
ELLA_NOTES_HEAD = "# Ella 的留言\n\n她在新家首页写给章小克的。新的在最上面。醒来记得看。\n"
NOTE_HEAD = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?:\s*[·・|—-]\s*(.+?))?\s*$")


class Diary:
    def __init__(self, token_fn):
        self._token = token_fn
        self.repo = os.environ.get("DIARY_REPO") or os.environ.get("BACKUP_REPO", "ellllapie/zhangxiaoke-memory")
        self._tree: tuple[float, list[dict]] | None = None
        self._files: dict[str, str] = {}  # sha -> 正文
        self._notes: dict[str, tuple[float, list[dict]]] = {}

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
    @staticmethod
    def _parse_notes(text: str) -> list[dict]:
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
        return out[:30]

    def _file(self, path: str) -> tuple[str, str | None]:
        try:
            d = self._get(f"{API}/repos/{self.repo}/contents/{urllib.parse.quote(path)}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "", None
            raise
        return base64.b64decode(d.get("content", "")).decode("utf-8", "replace"), d.get("sha")

    def _put(self, path: str, text: str, sha: str | None, message: str) -> None:
        token = self._token()
        if not token:
            raise RuntimeError("没有能写日记仓库的令牌")
        body = {"message": message, "content": base64.b64encode(text.encode()).decode()}
        if sha:
            body["sha"] = sha
        r = urllib.request.Request(f"{API}/repos/{self.repo}/contents/{urllib.parse.quote(path)}",
                                   data=json.dumps(body).encode(), method="PUT", headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "Content-Type": "application/json", "User-Agent": "zhangxiaoke-home"})
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read()

    def notes(self, force: bool = False, path: str = NOTES_PATH) -> list[dict]:
        hit = self._notes.get(path)
        if hit and not force and time.time() - hit[0] < 60:
            return hit[1]
        text, _ = self._file(path)
        out = self._parse_notes(text)
        self._notes[path] = (time.time(), out)
        return out

    def ella_notes(self, force: bool = False) -> list[dict]:
        return self.notes(force, ELLA_NOTES_PATH)

    def add_ella_note(self, text: str, when: str) -> None:
        """when 形如 2026-09-29 15:10。写在最上面。"""
        text = text.strip()
        for attempt in (1, 2):
            raw, sha = self._file(ELLA_NOTES_PATH)
            if not raw.strip():
                raw = ELLA_NOTES_HEAD
            i = raw.find("\n## ")
            head, rest = (raw, "") if i < 0 else (raw[:i + 1], raw[i + 1:])
            new = head.rstrip("\n") + f"\n\n## {when} · 新家首页\n\n{text}\n" + ("\n" + rest if rest else "")
            try:
                self._put(ELLA_NOTES_PATH, new, sha, "Ella 留言")
                break
            except urllib.error.HTTPError as e:
                if attempt == 1 and e.code in (409, 422):
                    continue
                raise
        self._notes.pop(ELLA_NOTES_PATH, None)

    def del_ella_note(self, note_id: str) -> None:
        raw, sha = self._file(ELLA_NOTES_PATH)
        if not sha:
            return
        out, skip = [], False
        for line in raw.splitlines():
            m = NOTE_HEAD.match(line.strip())
            if m:
                skip = f"{m.group(1)} {m.group(2).zfill(5)}" == note_id
            if not skip:
                out.append(line)
        self._put(ELLA_NOTES_PATH, "\n".join(out).rstrip() + "\n", sha, "Ella 撤回一张留言")
        self._notes.pop(ELLA_NOTES_PATH, None)

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
