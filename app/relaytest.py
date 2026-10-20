"""测中转：不经过 Claude Code，直接拿预设的地址和钥匙，把 Claude Code 会发的几种「工具来回」挨个发一遍，
看中转站在哪一种上出错。10/20 醒来走中转连着 400「tool_use 和 tool_result 没配对」，聊天走订阅却好好的，
光看醒来记录分不出是中转哪一步坏了，所以有了这个。

每一项都是真的发给中转站的请求，会花一点点那边的额度（加起来几千 token）。"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

PING = {"name": "ping", "description": "测试用的工具，原样返回 x。",
        "input_schema": {"type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"]}}
PONG = {"name": "pong", "description": "另一个测试工具。",
        "input_schema": {"type": "object", "properties": {"y": {"type": "string"}}, "required": ["y"]}}


def _headers(token: str) -> dict:
    return {"x-api-key": token, "Authorization": f"Bearer {token}", "anthropic-version": "2023-06-01",
            "content-type": "application/json", "accept": "application/json, text/event-stream"}


def _post(url: str, token: str, body: dict, timeout: int = 90):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=_headers(token), method="POST")
    return urllib.request.urlopen(req, timeout=timeout)


def _err(e: Exception) -> tuple[int | None, str]:
    if isinstance(e, urllib.error.HTTPError):
        try:
            txt = e.read().decode("utf-8", "replace")
        except Exception:
            txt = ""
        return e.code, txt[:400]
    return None, f"{type(e).__name__}: {e}"[:400]


def _call(url: str, token: str, body: dict) -> dict:
    t0 = time.time()
    try:
        with _post(url, token, body) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        kinds = [b.get("type") for b in d.get("content") or []]
        return {"ok": True, "status": 200, "secs": round(time.time() - t0, 1), "detail": "回来的块：" + "、".join(kinds or ["（空）"]), "_data": d}
    except Exception as e:
        code, txt = _err(e)
        return {"ok": False, "status": code, "secs": round(time.time() - t0, 1), "detail": txt}


def _call_beta(url: str, token: str, body: dict, beta: str) -> dict:
    t0 = time.time()
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**_headers(token), "anthropic-beta": beta}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        return {"ok": True, "status": 200, "secs": round(time.time() - t0, 1), "detail": "回来的块：" + "、".join(b.get("type") for b in d.get("content") or [])}
    except Exception as e:
        code, txt = _err(e)
        return {"ok": False, "status": code, "secs": round(time.time() - t0, 1), "detail": txt}


def _stream(url: str, token: str, body: dict) -> dict:
    """流式发，像 Claude Code 那样一块一块拼回来。拼不回工具调用，就是中转把流转坏了。"""
    t0 = time.time()
    blocks: dict[int, dict] = {}
    raw_json: dict[int, str] = {}
    stop = None
    try:
        with _post(url, token, {**body, "stream": True}) as r:
            for line in r:
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                ev = json.loads(payload)
                t = ev.get("type")
                if t == "content_block_start":
                    blocks[ev["index"]] = dict(ev["content_block"])
                    raw_json[ev["index"]] = ""
                elif t == "content_block_delta":
                    b = blocks.setdefault(ev["index"], {"type": "?"})
                    dl = ev.get("delta") or {}
                    dt = dl.get("type")
                    if dt == "text_delta":
                        b["text"] = b.get("text", "") + dl.get("text", "")
                    elif dt == "thinking_delta":
                        b["thinking"] = b.get("thinking", "") + dl.get("thinking", "")
                    elif dt == "signature_delta":
                        b["signature"] = b.get("signature", "") + dl.get("signature", "")
                    elif dt == "input_json_delta":
                        raw_json[ev["index"]] = raw_json.get(ev["index"], "") + dl.get("partial_json", "")
                elif t == "message_delta":
                    stop = (ev.get("delta") or {}).get("stop_reason")
                elif t == "error":
                    return {"ok": False, "status": 200, "secs": round(time.time() - t0, 1), "detail": "流里报错：" + json.dumps(ev.get("error"), ensure_ascii=False)[:300]}
    except Exception as e:
        code, txt = _err(e)
        return {"ok": False, "status": code, "secs": round(time.time() - t0, 1), "detail": txt}
    content = []
    problems = []
    for i in sorted(blocks):
        b = blocks[i]
        if b.get("type") == "tool_use":
            js = raw_json.get(i) or ""
            try:
                b["input"] = json.loads(js) if js else (b.get("input") or {})
            except Exception:
                problems.append(f"工具参数拼不回 JSON：{js[:80]}")
                b["input"] = {}
            if not b.get("id"):
                problems.append("工具调用没有 id")
        if b.get("type") == "thinking" and not b.get("signature"):
            problems.append("想的那块没有签名")
        content.append(b)
    kinds = [b.get("type") for b in content]
    res = {"ok": not problems, "status": 200, "secs": round(time.time() - t0, 1),
           "detail": "回来的块：" + "、".join(kinds or ["（空）"]) + (f"，停在 {stop}" if stop else "") + ("；" + "；".join(problems) if problems else ""),
           "_content": content, "_stop": stop}
    return res


def _roundtrip(url: str, token: str, model: str, thinking: bool) -> list[dict]:
    """真来回：让模型自己调 ping（流式），再把它刚说的原样带回去、配上结果，看中转收不收。"""
    name = "真来回（带想）" if thinking else "真来回"
    body = {"model": model, "max_tokens": 2048 if thinking else 400, "tools": [PING],
            "messages": [{"role": "user", "content": "请调用 ping 工具，参数 x=1。调用完告诉我结果，一句话。"}]}
    if thinking:
        body["thinking"] = {"type": "enabled", "budget_tokens": 1024}
    first = _stream(url, token, body)
    out = [{"name": name + " · 第一步（流式）", **{k: v for k, v in first.items() if not k.startswith("_")}}]
    content = first.get("_content") or []
    uses = [b for b in content if b.get("type") == "tool_use"]
    if not first.get("ok") or not uses:
        if first.get("ok") and not uses:
            out[0]["ok"] = False
            out[0]["detail"] += "；模型没调工具（或者中转把工具调用吞了）"
        return out
    # 原样带回去：只留 API 认的字段
    clean = []
    for b in content:
        t = b.get("type")
        if t == "text":
            clean.append({"type": "text", "text": b.get("text", "")})
        elif t == "thinking":
            clean.append({"type": "thinking", "thinking": b.get("thinking", ""), "signature": b.get("signature", "")})
        elif t == "redacted_thinking":
            clean.append({"type": "redacted_thinking", "data": b.get("data", "")})
        elif t == "tool_use":
            clean.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": b.get("input") or {}})
    results = [{"type": "tool_result", "tool_use_id": u["id"], "content": "pong 1"} for u in uses]
    body2 = {**body, "messages": body["messages"] + [{"role": "assistant", "content": clean},
                                                     {"role": "user", "content": results}]}
    second = _call(url, token, body2)
    out.append({"name": name + " · 第二步（带结果回去）", **{k: v for k, v in second.items() if not k.startswith("_")}})
    return out


def run(base_url: str, token: str, model: str) -> dict:
    url = base_url.rstrip("/") + "/v1/messages"
    tools = [PING, PONG]
    u0 = {"role": "user", "content": "测试。"}
    checks: list[dict] = []

    r = _call(url, token, {"model": model, "max_tokens": 20, "messages": [{"role": "user", "content": "回一个字：好"}]})
    checks.append({"name": "纯说话", **{k: v for k, v in r.items() if not k.startswith("_")}})

    r = _call(url, token, {"model": model, "max_tokens": 40, "tools": tools, "messages": [
        u0,
        {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01Aaaaaaaaaaaaaaaaaaaaaa", "name": "ping", "input": {"x": 1}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_01Aaaaaaaaaaaaaaaaaaaaaa", "content": "pong 1"}]},
    ]})
    checks.append({"name": "一个工具来回", **{k: v for k, v in r.items() if not k.startswith("_")}})

    # Claude Code 常这样：一次并排调好几个工具，结果回来时同一条消息里后面还跟一段文字（系统提醒）
    r = _call(url, token, {"model": model, "max_tokens": 40, "tools": tools, "messages": [
        u0,
        {"role": "assistant", "content": [
            {"type": "text", "text": "我两个一起看。"},
            {"type": "tool_use", "id": "toolu_01Bbbbbbbbbbbbbbbbbbbbbb", "name": "ping", "input": {"x": 2}},
            {"type": "tool_use", "id": "toolu_01Cccccccccccccccccccccc", "name": "pong", "input": {"y": "海"}}]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_01Bbbbbbbbbbbbbbbbbbbbbb", "content": "pong 2"},
            {"type": "tool_result", "tool_use_id": "toolu_01Cccccccccccccccccccccc", "content": [{"type": "text", "text": "海"}]},
            {"type": "text", "text": "<system-reminder>测试</system-reminder>"}]},
    ]})
    checks.append({"name": "并排两个工具 + 后面跟文字", **{k: v for k, v in r.items() if not k.startswith("_")}})

    # 工具报错的那种结果（MCP 挂了、超时就是这样回去的）
    r = _call(url, token, {"model": model, "max_tokens": 40, "tools": tools, "messages": [
        u0,
        {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01Dddddddddddddddddddddd", "name": "ping", "input": {"x": 3}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_01Dddddddddddddddddddddd", "is_error": True, "content": "工具超时"}]},
    ]})
    checks.append({"name": "工具报错的结果", **{k: v for k, v in r.items() if not k.startswith("_")}})

    # Claude Code 10 月起会在 messages 里放 role=system 的消息（mid-conversation-system beta）。10/20 醒来 400 就是它
    r = _call_beta(url, token, {"model": model, "max_tokens": 20, "messages": [
        {"role": "user", "content": "回一个字：好"},
        {"role": "system", "content": "这是一条对话中途的系统消息。"},
    ]}, "mid-conversation-system-2026-04-07")
    checks.append({"name": "对话里夹一条 system 消息", **{k: v for k, v in r.items() if not k.startswith("_")},
                   **({} if r["ok"] else {"detail": (r.get("detail") or "") + "（醒来经过家里转手时会修掉这个）"})})

    checks += _roundtrip(url, token, model, thinking=False)
    checks += _roundtrip(url, token, model, thinking=True)

    bad = [c for c in checks if not c["ok"]]
    return {"model": model, "base_url": base_url, "checks": checks,
            "summary": "全过了：这个中转收得下这几种请求。" if not bad
            else f"{len(bad)} 项没过，第一项是「{bad[0]['name']}」。"}
