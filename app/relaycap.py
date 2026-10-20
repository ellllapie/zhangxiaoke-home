"""抓中转报错：醒来走中转时，让 Claude Code 先经过新家自己转一手，中转一回错，就把 Claude Code 发出去的那一整个请求存下来，
再替它看一遍：消息怎么排的、哪个 tool_use 没有对上 tool_result、有没有中转可能不认的块。

10/20：中转「测一下」八项全过（普通工具来回它收得下），可醒来经过 Claude Code 第一步就 400「没配对」。
差别只能在 Claude Code 真正发出去的那个请求里，所以要把那个请求抓下来看。

只在「抓」打开的那段时间里接管醒来（默认 30 分钟），过时自动恢复直连。存下来的文件不含钥匙。"""
from __future__ import annotations

import json
import secrets
import time
from pathlib import Path

LOCAL_TOKEN = "home-relay-" + secrets.token_hex(16)   # Claude Code 拿这个来敲门，转手时换成真钥匙
KEEP = 10


class RelayCap:
    def __init__(self, data: Path):
        self.dir = data / "relay_capture"
        self.dir.mkdir(exist_ok=True)
        self.cfg = data / "relay_capture.json"

    def until(self) -> float:
        try:
            return float(json.loads(self.cfg.read_text(encoding="utf-8")).get("until") or 0)
        except Exception:
            return 0.0

    def active(self) -> bool:
        return self.until() > time.time()

    def arm(self, minutes: int = 30) -> float:
        u = time.time() + minutes * 60 if minutes > 0 else 0
        self.cfg.write_text(json.dumps({"until": u}), encoding="utf-8")
        return u

    def save(self, path: str, req_headers: dict, body: bytes, status: int | None, resp: str) -> str:
        ts = time.strftime("%Y%m%d-%H%M%S")
        try:
            req = json.loads(body.decode("utf-8", "replace"))
        except Exception:
            req = {"_raw": body[:4000].decode("utf-8", "replace")}
        hdr = {k: v for k, v in req_headers.items() if k.lower() not in ("authorization", "x-api-key", "cookie")}
        rec = {"at": ts, "path": path, "status": status, "response": resp[:4000], "headers": hdr,
               "analysis": analyse(req), "request": req}
        f = self.dir / f"{ts}.json"
        f.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        files = sorted(self.dir.glob("*.json"))
        for old in files[:-KEEP]:
            old.unlink(missing_ok=True)
        return f.name

    def list(self) -> list[dict]:
        out = []
        for f in sorted(self.dir.glob("*.json"), reverse=True)[:KEEP]:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append({"name": f.name, "at": d.get("at"), "status": d.get("status"), "path": d.get("path"),
                        "response": (d.get("response") or "")[:600], "analysis": d.get("analysis"),
                        "beta": d.get("headers", {}).get("anthropic-beta") or d.get("headers", {}).get("Anthropic-Beta")})
        return out


def _blocks(content) -> list[dict]:
    if isinstance(content, str):
        return [{"type": "text"}]
    return [b for b in content or [] if isinstance(b, dict)]


def analyse(req: dict) -> dict:
    """把请求拆开看：每条消息是哪些块；tool_use 后面那条有没有一一对上；有没有少见的块。"""
    msgs = req.get("messages") or []
    shape, problems, odd = [], [], set()
    common = {"text", "image", "document", "tool_use", "tool_result", "thinking", "redacted_thinking"}
    for i, m in enumerate(msgs):
        bl = _blocks(m.get("content"))
        kinds = [b.get("type") for b in bl]
        shape.append(f"{i} {m.get('role')}: " + " ".join(kinds))
        for b in bl:
            t = b.get("type")
            if t not in common:
                odd.add(t)
            if t == "tool_result" and isinstance(b.get("content"), list):
                for c in b["content"]:
                    if isinstance(c, dict) and c.get("type") not in ("text", "image", "document"):
                        odd.add(f"tool_result 里的 {c.get('type')}")
        if m.get("role") == "assistant":
            ids = [b.get("id") for b in bl if b.get("type") == "tool_use"]
            if ids:
                nxt = msgs[i + 1] if i + 1 < len(msgs) else None
                if not nxt or nxt.get("role") != "user":
                    problems.append(f"第 {i} 条的工具调用后面没有接一条 user")
                else:
                    nb = _blocks(nxt.get("content"))
                    got = [b.get("tool_use_id") for b in nb if b.get("type") == "tool_result"]
                    miss = [x for x in ids if x not in got]
                    extra = [x for x in got if x not in ids]
                    if miss:
                        problems.append(f"第 {i} 条有 {len(miss)} 个工具调用没收到结果")
                    if extra:
                        problems.append(f"第 {i+1} 条有 {len(extra)} 个结果找不到对应的调用")
                    first_other = next((k for k, b in enumerate(nb) if b.get("type") != "tool_result"), len(nb))
                    if any(b.get("type") == "tool_result" for b in nb[first_other:]):
                        problems.append(f"第 {i+1} 条里结果前面夹了别的块")
        if m.get("role") == "user" and i > 0 and any(b.get("type") == "tool_result" for b in bl):
            prev = msgs[i - 1]
            if prev.get("role") != "assistant" or not any(b.get("type") == "tool_use" for b in _blocks(prev.get("content"))):
                problems.append(f"第 {i} 条有工具结果，可前一条没有工具调用")
    for i in range(1, len(msgs)):
        if msgs[i].get("role") == msgs[i - 1].get("role"):
            problems.append(f"第 {i-1}、{i} 条都是 {msgs[i].get('role')}，没有一来一回")
    tools = req.get("tools") or []
    ttypes = sorted({t.get("type") for t in tools if isinstance(t, dict) and t.get("type")})
    deferred = sum(1 for t in tools if isinstance(t, dict) and t.get("defer_loading"))
    return {"model": req.get("model"), "messages": len(msgs), "tools": len(tools), "deferred_tools": deferred,
            "tool_types": ttypes, "thinking": req.get("thinking"), "stream": req.get("stream"),
            "shape": shape[-12:], "problems": problems, "odd_blocks": sorted(odd)}
