"""Kelivo 对话档案：把 Kelivo 的对话原话一直存在新家里。

Kelivo 自己会备份到 WebDAV（坚果云）。这里定时去拿最新那个备份包，只抽对话文字
（谁说的、什么时候、用的哪个模型、思考），存进 data/kelivo_archive.db。
- 只进不出：Kelivo 里删掉的窗口，档案里照样留着；同一个窗口有新消息就整窗更新。
- API key、MCP 配置、设置、图片都不落盘；聊天里贴过的 key / token 打码。备份包用完就删。

.env：KELIVO_WEBDAV_URL（备份所在目录，末尾带 /）、KELIVO_WEBDAV_USER、KELIVO_WEBDAV_PASS（坚果云用应用密码）
"""
import base64
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

SECRET_RES = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{16,}"),
]
SECRET_KV = re.compile(r"(?i)((?:api[_\- ]?key|apikey|token|secret|password|passwd|密码|密钥)[\"']?\s*[:=：]\s*[\"']?)[^\s\"',，]{8,}")


def redact(s):
    if not s:
        return s
    for rx in SECRET_RES:
        s = rx.sub("[已打码]", s)
    return SECRET_KV.sub(lambda m: m.group(1) + "[已打码]", s)


def to_ms(ts):
    """Kelivo 的时间戳有秒、毫秒、微秒几种，统一成毫秒。"""
    if ts is None:
        return None
    ts = float(ts)
    if ts > 1e14:
        return int(ts / 1e3)
    if ts > 1e11:
        return int(ts)
    return int(ts * 1e3)


class Kelivo:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "kelivo_archive.db"
        self.url = os.environ.get("KELIVO_WEBDAV_URL", "").strip()
        self.user = os.environ.get("KELIVO_WEBDAV_USER", "")
        self.pw = os.environ.get("KELIVO_WEBDAV_PASS", "")
        self.lock = threading.Lock()
        with self._db() as c:
            c.executescript("""
              CREATE TABLE IF NOT EXISTS convs(id TEXT PRIMARY KEY, title TEXT, created INTEGER, updated INTEGER,
                                               n INTEGER, seen_at INTEGER, gone INTEGER DEFAULT 0);
              CREATE TABLE IF NOT EXISTS msgs(conv TEXT, ord INTEGER, role TEXT, ts INTEGER, model TEXT, text TEXT, reasoning TEXT,
                                              PRIMARY KEY(conv, ord));
              CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
            """)

    @property
    def configured(self) -> bool:
        return bool(self.url and self.user and self.pw)

    def _db(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    def meta(self) -> dict:
        with self._db() as c:
            return {r["k"]: r["v"] for r in c.execute("SELECT k,v FROM meta")}

    # ── WebDAV ──
    def _auth(self):
        return "Basic " + base64.b64encode(f"{self.user}:{self.pw}".encode()).decode()

    def _latest(self):
        body = b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>'
        req = urllib.request.Request(self.url, data=body, method="PROPFIND",
                                     headers={"Authorization": self._auth(), "Depth": "1", "Content-Type": "application/xml"})
        with urllib.request.urlopen(req, timeout=60) as r:
            xml = r.read()
        ns = {"d": "DAV:"}
        best = None
        for resp in ET.fromstring(xml).findall("d:response", ns):
            href = resp.findtext("d:href", default="", namespaces=ns)
            name = urllib.parse.unquote(href.rstrip("/").split("/")[-1])
            if not (name.endswith(".zip") and "kelivo" in name.lower()):
                continue
            try:
                t = parsedate_to_datetime(resp.findtext(".//d:getlastmodified", default="", namespaces=ns)).timestamp()
            except Exception:
                t = 0
            if best is None or (t, name) > (best[0], best[2]):
                best = (t, href, name)
        return best

    def sync(self, force: bool = False, stale_min: float = 30) -> str:
        if not self.configured:
            return "新家的 .env 里还没填 KELIVO_WEBDAV_URL / KELIVO_WEBDAV_USER / KELIVO_WEBDAV_PASS"
        with self.lock:
            m = self.meta()
            if not force and time.time() - float(m.get("checked_at") or 0) < stale_min * 60:
                return "刚同步过"
            best = self._latest()
            self._set("checked_at", str(time.time()))
            if not best:
                return "坚果云那个目录里没找到 Kelivo 的备份包"
            _, href, name = best
            if m.get("backup") == name and not force:
                return f"没有新备份，还是 {name}"
            url = urllib.parse.urljoin(self.url, href)
            with tempfile.TemporaryDirectory() as td:
                zpath = os.path.join(td, "b.zip")
                req = urllib.request.Request(url, headers={"Authorization": self._auth()})
                with urllib.request.urlopen(req, timeout=300) as r, open(zpath, "wb") as f:
                    while chunk := r.read(1 << 20):
                        f.write(chunk)
                with zipfile.ZipFile(zpath) as z:
                    member = next((x for x in z.namelist() if x.endswith("kelivo.db")), None)
                    if not member:
                        return f"{name} 里没有 kelivo.db"
                    dbp = os.path.join(td, "kelivo.db")
                    with z.open(member) as s, open(dbp, "wb") as d:
                        while chunk := s.read(1 << 20):
                            d.write(chunk)
                n_conv, n_new = self._merge(dbp)
            # 临时目录连同备份包（里面有 API key）一起删掉
            self._set("backup", name)
            self._set("synced_at", str(time.time()))
            return f"已同步 {name}：{n_conv} 个窗口，其中 {n_new} 个有更新"

    def _set(self, k, v):
        with self._db() as c:
            c.execute("INSERT INTO meta VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

    def _merge(self, src_path: str):
        src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
        now = int(time.time() * 1000)
        seen, changed = set(), 0
        with self._db() as dst:
            for cid, title, created, updated, vsel in src.execute(
                    "SELECT id,title,created_at,updated_at,version_selections_json FROM conversation_rows"):
                seen.add(cid)
                old = dst.execute("SELECT updated, n FROM convs WHERE id=?", (cid,)).fetchone()
                if old and old["updated"] == to_ms(updated):
                    dst.execute("UPDATE convs SET seen_at=?, gone=0, title=? WHERE id=?", (now, title, cid))
                    continue
                msgs = self._messages(src, cid, vsel)
                # 只进不出：备份里这窗变短了（比如她删了几句），档案里那一份原样留着不动
                if not (old and old["n"] > len(msgs)):
                    dst.execute("DELETE FROM msgs WHERE conv=?", (cid,))
                    dst.executemany("INSERT INTO msgs VALUES (?,?,?,?,?,?,?)", [(cid, i, *m) for i, m in enumerate(msgs)])
                n = max(len(msgs), old["n"] if old else 0)
                dst.execute("INSERT INTO convs VALUES (?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET "
                            "title=excluded.title, updated=excluded.updated, n=excluded.n, seen_at=excluded.seen_at, gone=0",
                            (cid, title, to_ms(created), to_ms(updated), n, now))
                changed += 1
            # 备份里没有了的：标记一下，内容不动
            for (cid,) in dst.execute("SELECT id FROM convs WHERE gone=0").fetchall():
                if cid not in seen:
                    dst.execute("UPDATE convs SET gone=1 WHERE id=?", (cid,))
        src.close()
        return len(seen), changed

    @staticmethod
    def _messages(src, cid, vsel):
        try:
            sel = json.loads(vsel or "{}")
        except Exception:
            sel = {}
        rows = src.execute("SELECT id,role,timestamp,model_id,group_id,version FROM message_rows "
                           "WHERE conversation_id=? ORDER BY message_order", (cid,)).fetchall()
        maxv = {}
        for mid, _r, _t, _m, g, v in rows:
            maxv[g or mid] = max(maxv.get(g or mid, 0), v)
        out = []
        for mid, role, ts, model, g, v in rows:
            if v != sel.get(g or mid, maxv[g or mid]):
                continue   # 重新生成过的，只留她选中的那个版本
            texts, reasons = [], []
            for kind, payload in src.execute("SELECT kind,payload FROM message_part_rows WHERE revision_id=? ORDER BY ordinal", (mid,)):
                if kind == "text":
                    texts.append(payload)
                elif kind == "reasoning":
                    reasons.append(payload)
                elif kind == "image":
                    texts.append("[图片]")
                elif kind == "file":
                    texts.append("[文件]")
                elif kind == "tool_call":
                    try:
                        texts.append(f"[调用工具 {json.loads(payload).get('name', '?')}]")
                    except Exception:
                        texts.append("[调用工具]")
            text = "\n".join(t for t in texts if t).strip()
            reasoning = "\n".join(reasons).strip()
            if text or reasoning:
                out.append((role, to_ms(ts), model, redact(text), redact(reasoning) or None))
        return out

    # ── 读 ──
    def list(self, q: str = "", limit: int = 200):
        with self._db() as c:
            if q:
                rows = c.execute("SELECT DISTINCT c.* FROM convs c LEFT JOIN msgs m ON m.conv=c.id "
                                 "WHERE c.title LIKE ? OR m.text LIKE ? ORDER BY c.updated DESC LIMIT ?",
                                 (f"%{q}%", f"%{q}%", limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM convs ORDER BY updated DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def read(self, cid: str, start: int = 0, limit: int = 0):
        with self._db() as c:
            conv = c.execute("SELECT * FROM convs WHERE id=?", (cid,)).fetchone()
            if not conv:
                return None
            sql, args = "SELECT ord,role,ts,model,text,reasoning FROM msgs WHERE conv=? AND ord>=? ORDER BY ord", [cid, start]
            if limit:
                sql += " LIMIT ?"
                args.append(limit)
            return {"conv": dict(conv), "msgs": [dict(r) for r in c.execute(sql, args)]}

    def search(self, q: str, limit: int = 20):
        with self._db() as c:
            return [dict(r) for r in c.execute(
                "SELECT m.conv, c.title, m.ord, m.role, m.ts, m.text FROM msgs m JOIN convs c ON c.id=m.conv "
                "WHERE m.text LIKE ? ORDER BY m.ts DESC LIMIT ?", (f"%{q}%", limit))]
