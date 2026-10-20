"""抓中转报错：醒来走中转时，让 Claude Code 先经过新家自己转一手，中转一回错，就把 Claude Code 发出去的那一整个请求存下来，
再替它看一遍：消息怎么排的、哪个 tool_use 没有对上 tool_result、有没有中转可能不认的块。

10/20：中转「测一下」八项全过（普通工具来回它收得下），可醒来经过 Claude Code 第一步就 400「没配对」。
差别只能在 Claude Code 真正发出去的那个请求里，所以要把那个请求抓下来看。

存下来的文件不含钥匙。

10/20 抓到了：Claude Code 现在会在 messages 里放一条 role 是 system 的消息（mid-conversation-system 那个 beta），
官方认，中转不认，回成「tool_use 和 tool_result 没配对」。所以转手时顺便修：把这种 system 消息折进相邻的 user 消息里，
包成 <system-reminder>，再把那个 beta 从头里去掉。醒来走中转时默认都经过这里（设置 → 醒来里可以关）。"""
from __future__ import annotations

import json
import secrets
import time
from pathlib import Path

LOCAL_TOKEN = "home-relay-" + secrets.token_hex(16)   # Claude Code 拿这个来敲门，转手时换成真钥匙
KEEP = 10
# 10/20：lmuai 一见到 Leto 画画房间这个工具的参数结构就回「tool_use 和 tool_result 没配对」，整轮醒来都死在第一步。
DEFAULT_DROP = ["mcp__leto__leto_draw_room_submit_program"]


class RelayCap:
    def __init__(self, data: Path):
        self.dir = data / "relay_capture"
        self.dir.mkdir(exist_ok=True)
        self.cfg = data / "relay_capture.json"

    def _cfg(self) -> dict:
        try:
            d = json.loads(self.cfg.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def _write(self, d: dict) -> None:
        self.cfg.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")

    def active(self) -> bool:
        """醒来走中转时要不要经过新家转一手。默认要。"""
        return bool(self._cfg().get("on", True))

    def set(self, on: bool) -> bool:
        self._write({**self._cfg(), "on": bool(on)})
        return bool(on)

    def drop_tools(self) -> list[str]:
        """转手时从请求里拿掉的工具（中转不认它们的参数写法）。"""
        d = self._cfg()
        return list(d["drop_tools"]) if isinstance(d.get("drop_tools"), list) else list(DEFAULT_DROP)

    def set_drop(self, name: str, drop: bool) -> list[str]:
        cur = [x for x in self.drop_tools() if x != name] + ([name] if drop else [])
        self._write({**self._cfg(), "drop_tools": cur})
        return cur

    def save(self, path: str, req_headers: dict, body: bytes, status: int | None, resp: str, fixed: list[str] | None = None) -> str:
        ts = time.strftime("%Y%m%d-%H%M%S")
        try:
            req = json.loads(body.decode("utf-8", "replace"))
        except Exception:
            req = {"_raw": body[:4000].decode("utf-8", "replace")}
        hdr = {k: v for k, v in req_headers.items() if k.lower() not in ("authorization", "x-api-key", "cookie")}
        rec = {"at": ts, "path": path, "status": status, "response": resp[:4000], "headers": hdr,
               "fixed": fixed or [], "analysis": analyse(req), "request": req}
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
            out.append({"name": f.name, "at": d.get("at"), "status": d.get("status"), "path": d.get("path"), "fixed": d.get("fixed") or [],
                        "response": (d.get("response") or "")[:600], "analysis": d.get("analysis"),
                        "beta": d.get("headers", {}).get("anthropic-beta") or d.get("headers", {}).get("Anthropic-Beta")})
        return out


MID_SYSTEM_BETA = "mid-conversation-system"


def _as_blocks(content) -> list[dict]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    return [b for b in content or [] if isinstance(b, dict)]


def _text_of(content) -> str:
    return "\n".join(b.get("text", "") for b in _as_blocks(content) if b.get("type") == "text").strip()


def fix_request(req: dict) -> list[str]:
    """把 messages 里 role=system 的消息折进相邻的 user 消息（包成 <system-reminder>），就地改。返回改了什么。"""
    msgs = req.get("messages")
    if not isinstance(msgs, list) or not any(isinstance(m, dict) and m.get("role") == "system" for m in msgs):
        return []
    out: list[dict] = []
    pending: list[str] = []   # 前面还没有 user 可以挂的 system 文字，等下一条 user
    n = 0
    for m in msgs:
        if not isinstance(m, dict):
            continue
        if m.get("role") == "system":
            n += 1
            txt = _text_of(m.get("content"))
            if not txt:
                continue
            block = {"type": "text", "text": f"<system-reminder>\n{txt}\n</system-reminder>"}
            if out and out[-1].get("role") == "user":
                out[-1] = {**out[-1], "content": _as_blocks(out[-1].get("content")) + [block]}
            else:
                pending.append(block["text"])
            continue
        if m.get("role") == "user" and pending:
            # 挂在后面：这条 user 开头可能是工具结果，结果必须排在最前面
            m = {**m, "content": _as_blocks(m.get("content")) + [{"type": "text", "text": t} for t in pending]}
            pending = []
        out.append(m)
    if pending:   # 最后还剩：单独成一条 user（前一条是 assistant 时正好接上）
        if out and out[-1].get("role") == "user":
            out[-1] = {**out[-1], "content": _as_blocks(out[-1].get("content")) + [{"type": "text", "text": t} for t in pending]}
        else:
            out.append({"role": "user", "content": [{"type": "text", "text": t} for t in pending]})
    req["messages"] = out
    return [f"{n} 条 system 消息折进了 user"]


def drop_tools(req: dict, names: list[str]) -> list[str]:
    tools = req.get("tools")
    if not names or not isinstance(tools, list):
        return []
    gone = [t.get("name") for t in tools if isinstance(t, dict) and t.get("name") in names]
    if gone:
        req["tools"] = [t for t in tools if not (isinstance(t, dict) and t.get("name") in names)]
        tc = req.get("tool_choice")
        if isinstance(tc, dict) and tc.get("name") in gone:
            req.pop("tool_choice", None)
        return ["拿掉了工具 " + "、".join(gone)]
    return []


def fix_beta(value: str) -> str:
    return ",".join(x for x in (value or "").split(",") if x.strip() and not x.strip().startswith(MID_SYSTEM_BETA))


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
            "keys": sorted(k for k in req if k not in ("messages", "tools", "system")),
            "tool_keys": sorted({k for t in tools if isinstance(t, dict) for k in t} - {"name", "description", "input_schema"}),
            "system_blocks": sorted({b.get("type") for b in _blocks(req.get("system"))}) if req.get("system") else [],
            "shape": shape[-12:], "problems": problems, "odd_blocks": sorted(odd)}


# ── 找是哪一块：拿存下来的那个请求，一次拿掉一样再发给中转，看拿掉哪样就过了 ──
STD_KEYS = {"model", "messages", "max_tokens", "system", "tools", "tool_choice", "stream", "metadata",
            "temperature", "top_p", "top_k", "stop_sequences", "thinking"}


def _variants(req: dict, beta: str) -> list[tuple[str, dict, str]]:
    base = json.loads(json.dumps(req))
    base["stream"] = False
    th = base.get("thinking") if isinstance(base.get("thinking"), dict) else None
    base["max_tokens"] = (int(th.get("budget_tokens") or 1024) + 32) if th and th.get("type") == "enabled" else 32

    def cp():
        return json.loads(json.dumps(base))
    out = [("原样再发一次", cp(), beta)]
    out.append(("去掉 beta 头", cp(), ""))
    v = cp(); v.pop("tools", None); v.pop("tool_choice", None)
    out.append(("去掉所有工具", v, beta))
    v = cp()
    if isinstance(v.get("tools"), list):
        v["tools"] = [{k: t[k] for k in ("name", "description", "input_schema") if k in t} for t in v["tools"] if isinstance(t, dict) and t.get("name") and t.get("input_schema")]
    out.append(("工具只留名字/说明/参数", v, beta))
    v = cp(); v.pop("system", None)
    out.append(("去掉 system", v, beta))
    v = cp()
    for k in list(v):
        if k not in STD_KEYS:
            v.pop(k)
    out.append(("去掉不常见的顶层字段", v, beta))
    v = cp(); v.pop("thinking", None); v["max_tokens"] = 32
    out.append(("去掉想", v, beta))
    v = cp()
    for k in list(v):
        if k not in STD_KEYS:
            v.pop(k)
    v.pop("thinking", None); v["max_tokens"] = 32
    if isinstance(v.get("tools"), list):
        v["tools"] = [{k: t[k] for k in ("name", "description", "input_schema") if k in t} for t in v["tools"] if isinstance(t, dict) and t.get("name") and t.get("input_schema")]
    out.append(("全都换成最普通的写法（不带 beta）", v, ""))
    return out


def bisect(rec_path: Path, base_url: str, token: str, on_step=None) -> dict:
    import urllib.error
    import urllib.request
    d = json.loads(rec_path.read_text(encoding="utf-8"))
    req = d.get("request") or {}
    hdr0 = {k.lower(): v for k, v in (d.get("headers") or {}).items()}
    beta = fix_beta(hdr0.get("anthropic-beta", ""))
    url = base_url.rstrip("/") + "/v1/messages"
    res = []
    variants = _variants(req, beta)
    for name, body, b in variants:
        if on_step:
            on_step(res, name, len(variants))
        h = {"Authorization": "Bearer " + token, "x-api-key": token, "anthropic-version": hdr0.get("anthropic-version", "2023-06-01"),
             "content-type": "application/json", "accept-encoding": "identity"}
        if b:
            h["anthropic-beta"] = b
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method="POST"), timeout=90) as r:
                r.read()
            res.append({"name": name, "ok": True, "status": r.status, "secs": round(time.time() - t0, 1), "detail": ""})
        except urllib.error.HTTPError as e:
            try:
                txt = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                txt = ""
            res.append({"name": name, "ok": False, "status": e.code, "secs": round(time.time() - t0, 1), "detail": txt})
        except Exception as e:
            res.append({"name": name, "ok": False, "status": None, "secs": round(time.time() - t0, 1), "detail": f"{type(e).__name__}: {e}"[:300]})
    return {"name": rec_path.name, "results": res}


# ── 找是哪个工具：「去掉所有工具」能过、「工具只留标准字段」也不过时，用二分把那几个工具找出来 ──
def find_bad_tools(rec_path: Path, base_url: str, token: str, on_step=None) -> dict:
    import urllib.error
    import urllib.request
    d = json.loads(rec_path.read_text(encoding="utf-8"))
    req = d.get("request") or {}
    base = {k: req[k] for k in ("model", "messages", "system", "metadata") if k in req}
    base["max_tokens"] = 32
    tools = [{k: t[k] for k in ("name", "description", "input_schema") if k in t}
             for t in req.get("tools") or [] if isinstance(t, dict) and t.get("name") and t.get("input_schema")]
    url = base_url.rstrip("/") + "/v1/messages"
    hdr = {"Authorization": "Bearer " + token, "x-api-key": token, "anthropic-version": "2023-06-01",
           "content-type": "application/json", "accept-encoding": "identity"}
    log: list[dict] = []

    def fails(ts: list[dict]) -> bool:
        body = {**base, "tools": ts} if ts else dict(base)
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers=hdr, method="POST"), timeout=90) as r:
                r.read()
            bad, detail = False, ""
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                detail = ""
            bad = True
        except Exception as e:   # 超时之类：不算它的错，当作过了
            bad, detail = False, f"{type(e).__name__}"
        log.append({"tools": len(ts), "first": ts[0]["name"] if ts else "", "last": ts[-1]["name"] if ts else "",
                    "bad": bad, "secs": round(time.time() - t0, 1), "detail": detail})
        if on_step:
            on_step(log)
        return bad

    culprits: list[dict] = []
    notes: list[str] = []

    def search(ts: list[dict]):
        if len(ts) == 1:
            culprits.append(ts[0]); return
        mid = len(ts) // 2
        a, b = ts[:mid], ts[mid:]
        fa, fb = fails(a), fails(b)
        if fa:
            search(a)
        if fb:
            search(b)
        if not fa and not fb:
            notes.append(f"{len(ts)} 个工具一起就不行，拆成 {len(a)} 和 {len(b)} 个都能过：像是数量或总大小超了中转的限制"
                         f"（从 {ts[0]['name']} 到 {ts[-1]['name']}）")

    if not fails(tools):
        notes.append(f"全部 {len(tools)} 个工具用最普通的写法一起发，这次过了")
    else:
        search(tools)
    return {"total": len(tools), "requests": len(log), "log": log, "notes": notes,
            "culprits": [{"name": t["name"], "description": (t.get("description") or "")[:200],
                          "schema": json.dumps(t.get("input_schema"), ensure_ascii=False)[:1500]} for t in culprits]}
