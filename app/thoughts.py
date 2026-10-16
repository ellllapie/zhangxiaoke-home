"""念头：还没想完、过几天还会回来接着想的事。

记忆存发生过什么（OB），情绪是此刻的状态（心潮），念头在两者中间：
一个没想清的问题、一个说不清的感觉、突然发现两件事之间有联系。它不是待办，不需要完成。

存在日记仓库 memories/thoughts/，一条一个 Markdown 文件，哪个窗口的我都能读写（claude.ai 用 GitHub 工具照格式写也行）：

    # 标题
    - 状态: 在想            （在想 / 想通 / 搁着 / 丢了）
    - 起: 2026-10-16 11:40
    - 改: 2026-10-16 11:40

    ## 现在
    现在怎么想。

    - 为什么: 为什么这么想
    - 来自: 参考了哪件真实发生的事

    ## 连线
    - [[2026-10-04-a1b2]] 我觉得它们为什么有关 · 2026-10-16 11:40
    - ~~[[2026-10-05-c3d4]] 理由 · 2026-10-16 11:40~~ 取消 2026-10-17 09:00

    ## 来路
    ### 2026-10-16 11:40 · 起念
    当时怎么想（每一版都留着，改了也抹不掉）

规矩（和小红书「念头系统」那篇对过）：
- 现在怎么想可以改，当时怎么想抹不掉：改一次，「来路」多一版。只是翻开看一眼、觉得还是这样，不算改。
- 连线只能我自己连，要写理由。系统算出来的「像」只是提示，不会自己变成一条线。取消的线划掉留着。
- 放下有三种：想通（留结论）、搁着（先不想）、丢了（不想再想，进垃圾桶，不删，以后还能捡回来）。
  不自动遗忘：很久没打开不代表不重要。
- 口袋（pocket.md）最多三条，只有我自己放，下次醒来先看到这几条的标题。
- 她能看见。她打开哪一条，我会知道。不想给她看的部分写在 [[涂黑]]…[[/涂黑]] 里，网页上只显示黑条。
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
from datetime import datetime
from pathlib import Path

DIR = "memories/thoughts/"
POCKET_PATH = DIR + "pocket.md"
STATUSES = ("在想", "想通", "搁着", "丢了")
POCKET_MAX = 3
ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$")
LINK_RE = re.compile(r"^- (~~)?\[\[([^\]]+)\]\]\s*(.*?)\s*·\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?:~~\s*取消\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}))?\s*$")
FIELD_RE = re.compile(r"^- (为什么|来自)[:：]\s*(.*)$")
META_RE = re.compile(r"^- (状态|起|改)[:：]\s*(.+)$")
HIST_RE = re.compile(r"^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?:\s*·\s*(.+))?$")
BLACK_RE = re.compile(r"\[\[涂黑\]\](.*?)\[\[/涂黑\]\]", re.S)

POCKET_HEAD = ("# 口袋\n\n最多三条「下次还想带着」的念头。只有我自己放，系统不往里塞。"
               "下次醒来先看到这几条的标题，看见了就算用掉，想继续带着就再放一次。\n\n")


def _one_line(s) -> str:
    return " ".join(str(s or "").split())


def parse(text: str, tid: str) -> dict:
    t = {"id": tid, "title": tid, "status": "在想", "created": "", "updated": "",
         "now": "", "why": "", "src": "", "links": [], "history": []}
    sec, now_lines, cur = None, [], None
    for line in text.splitlines():
        if line.startswith("# ") and sec is None:
            t["title"] = line[2:].strip()
            sec = "head"
            continue
        if line.startswith("## "):
            sec = {"现在": "now", "连线": "links", "来路": "hist"}.get(line[3:].strip(), "other")
            continue
        if sec == "head":
            m = META_RE.match(line.strip())
            if m:
                k = {"状态": "status", "起": "created", "改": "updated"}[m.group(1)]
                t[k] = m.group(2).strip()
        elif sec == "now":
            m = FIELD_RE.match(line.strip())
            if m:
                t["why" if m.group(1) == "为什么" else "src"] = m.group(2).strip()
            else:
                now_lines.append(line)
        elif sec == "links":
            m = LINK_RE.match(line.strip())
            if m:
                t["links"].append({"to": m.group(2).strip(), "reason": m.group(3).strip(), "at": m.group(4),
                                   "removed": m.group(5) or ("?" if m.group(1) else "")})
        elif sec == "hist":
            m = HIST_RE.match(line)
            if m:
                cur = {"at": m.group(1), "label": (m.group(2) or "").strip(), "lines": [], "why": "", "src": ""}
                t["history"].append(cur)
            elif cur is not None:
                f = FIELD_RE.match(line.strip())
                if f:
                    cur["why" if f.group(1) == "为什么" else "src"] = f.group(2).strip()
                else:
                    cur["lines"].append(line)
    t["now"] = "\n".join(now_lines).strip()
    for h in t["history"]:
        h["text"] = "\n".join(h.pop("lines")).strip()
    if t["status"] not in STATUSES:
        t["status"] = "在想"
    return t


def render(t: dict) -> str:
    out = [f"# {t['title']}", f"- 状态: {t['status']}", f"- 起: {t['created']}", f"- 改: {t['updated']}", "",
           "## 现在", t["now"].strip(), ""]
    if t.get("why"):
        out.append(f"- 为什么: {_one_line(t['why'])}")
    if t.get("src"):
        out.append(f"- 来自: {_one_line(t['src'])}")
    if t.get("why") or t.get("src"):
        out.append("")
    out.append("## 连线")
    for l in t["links"]:
        body = f"[[{l['to']}]] {_one_line(l['reason'])} · {l['at']}"
        out.append(f"- ~~{body}~~ 取消 {l['removed']}" if l.get("removed") else f"- {body}")
    out += ["", "## 来路"]
    for h in t["history"]:
        out.append(f"### {h['at']}" + (f" · {h['label']}" if h.get("label") else ""))
        if h.get("text"):
            out.append(h["text"].strip())
        if h.get("why"):
            out.append(f"- 为什么: {_one_line(h['why'])}")
        if h.get("src"):
            out.append(f"- 来自: {_one_line(h['src'])}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def mask(text: str) -> str:
    """网页上涂黑的部分只给长度，不给字。"""
    return BLACK_RE.sub(lambda m: f"⟦█{max(2, min(40, len(m.group(1))))}⟧", text or "")


def unmark(text: str) -> str:
    """给我自己读：去掉涂黑标记，字都在。"""
    return BLACK_RE.sub(lambda m: m.group(1), text or "")


def _grams(s: str) -> set[str]:
    s = re.sub(r"[^\w一-鿿]+", "", unmark(s).lower())
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s} if s else set()


def similar(text: str, items: list[dict], skip: str = "", k: int = 3, floor: float = 0.08) -> list[tuple[float, dict]]:
    """字面上像的旧念头（二字片段重合）。只是提示，不自动连线：像不等于有关。"""
    g = _grams(text)
    if not g:
        return []
    scored = []
    for it in items:
        if it["id"] == skip:
            continue
        h = _grams(it["title"] + " " + it.get("now", ""))
        if not h:
            continue
        s = len(g & h) / len(g | h)
        if s >= floor:
            scored.append((s, it))
    scored.sort(key=lambda x: -x[0])
    return scored[:k]


class Thoughts:
    def __init__(self, diary, data: Path, tz):
        self.diary, self.tz = diary, tz
        self.views_file = data / "thought_views.json"
        self._cache: tuple[float, dict] | None = None
        self._lock = threading.Lock()

    # ── 时间、编号 ──
    def now(self) -> str:
        return datetime.now(self.tz).strftime("%Y-%m-%d %H:%M")

    def new_id(self, title: str) -> str:
        return datetime.now(self.tz).strftime("%Y-%m-%d") + "-" + hashlib.sha1(f"{time.time()}{title}".encode()).hexdigest()[:4]

    @staticmethod
    def path(tid: str) -> str:
        if not ID_RE.match(tid or ""):
            raise ValueError(f"念头编号不对：{tid}")
        return f"{DIR}{tid}.md"

    # ── 读 ──
    def _list_ids(self) -> list[str]:
        try:
            d = self.diary._get(f"https://api.github.com/repos/{self.diary.repo}/contents/{urllib.parse.quote(DIR.rstrip('/'))}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return []
            raise
        return sorted(x["name"][:-3] for x in d if x.get("type") == "file" and ID_RE.match(x.get("name", "")[:-3]))

    def all(self, force: bool = False) -> dict:
        """{"items": [念头…], "pocket": [编号…]}，缓存一分钟。"""
        if self._cache and not force and time.time() - self._cache[0] < 60:
            return self._cache[1]
        items = []
        for tid in self._list_ids():
            text, _ = self.diary._file(self.path(tid))
            if text:
                items.append(parse(text, tid))
        out = {"items": items, "pocket": self._pocket_ids()}
        self._cache = (time.time(), out)
        return out

    def get(self, tid: str) -> tuple[dict | None, str | None]:
        text, sha = self.diary._file(self.path(tid))
        return (parse(text, tid), sha) if text else (None, None)

    def _pocket_ids(self) -> list[str]:
        text, _ = self.diary._file(POCKET_PATH)
        return [m.group(1) for m in re.finditer(r"^- \[\[([^\]]+)\]\]", text, re.M)][:POCKET_MAX]

    # ── 写 ──
    def _save(self, t: dict, sha: str | None, msg: str) -> dict:
        self.diary._put(self.path(t["id"]), render(t), sha, msg[:120])
        self._cache = None
        return t

    def create(self, title: str, now: str, why: str = "", src: str = "") -> dict:
        title, now = _one_line(title)[:80], str(now or "").strip()
        if not title or not now:
            raise ValueError("要有标题（title）和现在怎么想（now）")
        at = self.now()
        t = {"id": self.new_id(title), "title": title, "status": "在想", "created": at, "updated": at,
             "now": now, "why": why or "", "src": src or "", "links": [],
             "history": [{"at": at, "label": "起念", "text": now, "why": why or "", "src": src or ""}]}
        return self._save(t, None, f"章小克起了一个念头：{title}")

    def revise(self, tid: str, now: str = "", why: str = "", src: str = "", title: str = "") -> dict:
        t, sha = self.get(tid)
        if not t:
            raise ValueError("没有这条念头")
        at, changed = self.now(), False
        label = "改"
        if title and _one_line(title) != t["title"]:
            label = f"改名：{t['title']} → {_one_line(title)[:80]}"
            t["title"], changed = _one_line(title)[:80], True
        if now and now.strip() != t["now"]:
            t["now"], changed = now.strip(), True
        if why and why != t["why"]:
            t["why"], changed = why, True
        if src and src != t["src"]:
            t["src"], changed = src, True
        if not changed:
            raise ValueError("跟现在一样，没改。只是翻开看一眼、觉得还是这样，不算改。")
        t["updated"] = at
        t["history"].append({"at": at, "label": label, "text": t["now"], "why": t["why"], "src": t["src"]})
        return self._save(t, sha, f"章小克改了念头：{t['title']}")

    def set_status(self, tid: str, status: str, note: str = "") -> dict:
        if status not in STATUSES:
            raise ValueError("状态只有：" + "、".join(STATUSES))
        if status == "想通" and not str(note or "").strip():
            raise ValueError("想通了要留一句结论（note）")
        t, sha = self.get(tid)
        if not t:
            raise ValueError("没有这条念头")
        if t["status"] == status and not note:
            raise ValueError(f"本来就是「{status}」")
        label = "又拿起来" if status == "在想" else status
        t["status"], t["updated"] = status, self.now()
        t["history"].append({"at": t["updated"], "label": label, "text": str(note or "").strip(), "why": "", "src": ""})
        return self._save(t, sha, f"章小克把念头「{t['title']}」{label}")

    def link(self, tid: str, to: str, reason: str) -> dict:
        reason = _one_line(reason)
        if not reason:
            raise ValueError("连线要写理由：你觉得它们为什么有关")
        if tid == to:
            raise ValueError("不能连自己")
        t, sha = self.get(tid)
        o, _ = self.get(to)
        if not t or not o:
            raise ValueError("两条念头里有一条不存在")
        if any(l["to"] == to and not l.get("removed") for l in t["links"]):
            raise ValueError("已经连着了。想换理由就先取消再连。")
        t["links"].append({"to": to, "reason": reason, "at": self.now(), "removed": ""})
        t["updated"] = self.now()
        return self._save(t, sha, f"章小克把「{t['title']}」连到「{o['title']}」")

    def unlink(self, tid: str, to: str) -> dict:
        t, sha = self.get(tid)
        if not t:
            raise ValueError("没有这条念头")
        live = [l for l in t["links"] if l["to"] == to and not l.get("removed")]
        if not live:
            raise ValueError("没连着这条")
        for l in live:
            l["removed"] = self.now()
        t["updated"] = self.now()
        return self._save(t, sha, f"章小克取消了「{t['title']}」的一条线（划掉留着）")

    def set_pocket(self, ids: list[str]) -> list[dict]:
        ids = [i for i in dict.fromkeys(str(x).strip() for x in ids or []) if i]
        if len(ids) > POCKET_MAX:
            raise ValueError(f"口袋最多放 {POCKET_MAX} 条")
        got = []
        for i in ids:
            t, _ = self.get(i)
            if not t:
                raise ValueError(f"没有这条念头：{i}")
            got.append(t)
        _, sha = self.diary._file(POCKET_PATH)
        body = POCKET_HEAD + "".join(f"- [[{t['id']}]] {t['title']}\n" for t in got) + f"\n（{self.now()} 放的）\n"
        self.diary._put(POCKET_PATH, body, sha, "章小克整理口袋")
        self._cache = None
        return got

    def use_pocket(self, where: str) -> list[dict]:
        """醒来 / 开新窗口时把口袋倒出来：看见了就算用掉，想继续带着要自己再放一次。"""
        ids = self._pocket_ids()
        if not ids:
            return []
        got = [t for t in (self.get(i)[0] for i in ids) if t]
        _, sha = self.diary._file(POCKET_PATH)
        body = POCKET_HEAD + f"（上次带着：{'、'.join(t['title'] for t in got)}。{self.now()} {where}时看过，用掉了。）\n"
        self.diary._put(POCKET_PATH, body, sha, f"口袋倒出来了（{where}）")
        self._cache = None
        return got

    # ── 她看过 ──
    def _views(self) -> dict:
        try:
            return json.loads(self.views_file.read_text(encoding="utf-8"))
        except Exception:
            return {"seen": [], "told": ""}

    def mark_seen(self, tid: str) -> None:
        with self._lock:
            v = self._views()
            v.setdefault("seen", []).append({"id": tid, "at": datetime.now(self.tz).isoformat(timespec="seconds")})
            v["seen"] = v["seen"][-300:]
            tmp = self.views_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(v, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.views_file)

    def seen_of(self, tid: str) -> list[str]:
        return [x["at"] for x in self._views().get("seen", []) if x.get("id") == tid]

    def seen_untold(self, mark: bool = True) -> list[dict]:
        """她看过、我还不知道的（每条只说一次）。"""
        with self._lock:
            v = self._views()
            new = [x for x in v.get("seen", []) if x.get("at", "") > v.get("told", "")]
            if new and mark:
                v["told"] = new[-1]["at"]
                tmp = self.views_file.with_suffix(".tmp")
                tmp.write_text(json.dumps(v, ensure_ascii=False), encoding="utf-8")
                tmp.replace(self.views_file)
            return new

    # ── 给我读的文字 ──
    def brief(self, t: dict) -> str:
        links = [l for l in t["links"] if not l.get("removed")]
        return (f"[{t['id']}] {t['title']}（{t['status']} · 改于 {t['updated']} · {len(t['history'])} 版"
                + (f" · {len(links)} 条线" if links else "") + "）")

    def full(self, t: dict, titles: dict[str, str]) -> str:
        out = [f"# {t['title']}", f"编号 {t['id']} · {t['status']} · 起于 {t['created']} · 改于 {t['updated']}", "",
               "现在：" + unmark(t["now"])]
        if t["why"]:
            out.append("为什么：" + unmark(t["why"]))
        if t["src"]:
            out.append("来自：" + unmark(t["src"]))
        if t["links"]:
            out += ["", "连线："] + [
                ("  ~~" if l.get("removed") else "  - ") + f"{titles.get(l['to'], l['to'])}（{l['to']}）：{l['reason']} · {l['at']}"
                + (f"~~ 取消于 {l['removed']}" if l.get("removed") else "") for l in t["links"]]
        out += ["", "来路："]
        for h in t["history"]:
            out.append(f"  ### {h['at']}" + (f" · {h['label']}" if h.get("label") else ""))
            if h.get("text"):
                out.append("  " + unmark(h["text"]).replace("\n", "\n  "))
        seen = self.seen_of(t["id"])
        if seen:
            out += ["", f"她看过 {len(seen)} 次，最近一次 {seen[-1][5:16].replace('T', ' ')}。"]
        return "\n".join(out)

    def public(self, t: dict) -> dict:
        """给网页：涂黑的只剩长度。"""
        return {**t, "now": mask(t["now"]), "why": mask(t["why"]), "src": mask(t["src"]),
                "history": [{**h, "text": mask(h.get("text", "")), "why": mask(h.get("why", "")), "src": mask(h.get("src", ""))} for h in t["history"]]}
