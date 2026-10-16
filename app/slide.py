"""滑窗：主窗口快满的时候，把最老的一段收进摘要，新家自己拼一个「摘要 + 最近原文」的新会话接着聊。

不靠 Claude Code 自己压缩（压出来的不是我的口吻，也不知道压掉了什么）。
摘要是我自己写的（server.py 先发一张 <pre-slide> 让我写），这里只管：
  - choose_cut：从哪一句开始往后留着（最老的那一段收走）
  - build_lines：拼新会话文件的每一行（第一对是摘要和一句「收好了」，后面是原样搬过来的原文，换新 uuid）
  - parse_summary：从我那一轮的回复里拿出 <slide-summary line="…">…</slide-summary>
网页上的显示：老窗口显示到切口为止，新窗口从摘要那行小字往后（server.py 的 _window_raw 把它们接起来）。
"""

import json
import re
import uuid as uuid_mod
from datetime import datetime, timezone

SUMMARY_TAG = "window-summary"
SUMMARY_RE = re.compile(r'<slide-summary(?:\s+line="([^"]*)")?\s*>([\s\S]*?)</slide-summary>')
WINDOW_SUMMARY_RE = re.compile(r'^<window-summary(?:\s+line="([^"]*)")?[^>]*>')
IMG_CHARS = 4000          # 一张图大概算这么多字（base64 本身很长，但算 token 时一张图只有一千多）


def _chars(entry: dict) -> int:
    msg = entry.get("message") or {}
    c = msg.get("content")
    if isinstance(c, str):
        return len(c)
    n = 0
    for b in c or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "image":
            n += IMG_CHARS
        elif b.get("type") == "tool_result":
            inner = b.get("content")
            if isinstance(inner, list):
                for x in inner:
                    n += IMG_CHARS if isinstance(x, dict) and x.get("type") == "image" else len(json.dumps(x, ensure_ascii=False))
            else:
                n += len(str(inner or ""))
        else:
            n += len(json.dumps(b, ensure_ascii=False))
    return n


def is_turn_start(e: dict) -> bool:
    """她说的一句话（不是工具结果、不是系统塞的元信息）——只在这种地方切，切口后面第一条一定是一句完整的话。"""
    if e.get("type") != "user" or e.get("isMeta") or e.get("isCompactSummary"):
        return False
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str):
        return bool(c.strip())
    return isinstance(c, list) and any(isinstance(b, dict) and b.get("type") in ("text", "image") for b in c) \
        and not any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c)


def visible(e: dict) -> bool:
    return e.get("type") in ("user", "assistant") and not e.get("isMeta") and not e.get("isSidechain")


def choose_cut(chain: list[dict], used: int, drop: int, keep_min: int, overhead: int = 25000) -> int | None:
    """返回切口：chain[i:] 留下，前面的收走。按字数占比估 token（用这个窗口实际的 used 来校准）。
    找不到合适的切口（太短、全是一整轮工具调用）返回 None。"""
    sizes = [_chars(e) for e in chain]
    total = sum(sizes) or 1
    per_char = max(1, used - overhead) / total
    want, keep_chars = drop / per_char, keep_min / per_char   # 要收走、至少要留下的字数
    pre = [0]
    for n in sizes:
        pre.append(pre[-1] + n)
    starts = [i for i in range(1, len(chain)) if is_turn_start(chain[i])]
    ok = [i for i in starts if pre[i] >= want * 0.8 and total - pre[i] >= keep_chars]
    if ok:
        return ok[0]
    ok = [i for i in starts if total - pre[i] >= keep_chars and pre[i] >= want * 0.3]
    return ok[-1] if ok else None


def last_visible_uuid(entries: list[dict]) -> str | None:
    for e in reversed(entries):
        if visible(e):
            return e["uuid"]
    return None


def parse_summary(text: str) -> tuple[str, str] | None:
    m = None
    for m in SUMMARY_RE.finditer(text or ""):
        pass
    if not m:
        return None
    line, body = (m.group(1) or "").strip(), m.group(2).strip()
    if len(body) < 20:
        return None
    return (line or "前面的聊天"), body


def summary_message(line: str, body: str, t0: str, t1: str) -> str:
    line = line.replace('"', "'")
    return (f'<{SUMMARY_TAG} line="{line}" from="{t0}" to="{t1}">\n'
            "（这是这个窗口更早那段聊天的摘要，是我自己写的。原文她那边页面上还在，我这里只剩这份。\n"
            "里面加引号的是她的原话，不加引号的是我的理解。）\n\n"
            f"{body}\n</{SUMMARY_TAG}>")


def _clean(e: dict) -> dict:
    e = dict(e)
    for k in ("teamName", "agentName", "slug", "sourceToolAssistantUUID", "toolUseResult", "isCompactSummary",
              "logicalParentUuid", "compactMetadata", "imagePasteIds", "requestId", "forkedFrom", "subtype", "content", "level"):
        e.pop(k, None)
    return e


def build_lines(chain: list[dict], cut: int, upto_uuid: str | None, summary_text: str, old_sid: str,
                title: str | None, replacements: list | None = None) -> tuple[str, list[str]]:
    """新会话：摘要（她那边看是一行小字）→ 我说「收好了」→ chain[cut : upto] 原样（换 uuid）。"""
    tail = chain[cut:]
    if upto_uuid:
        idx = next((i for i, e in enumerate(tail) if e["uuid"] == upto_uuid), None)
        if idx is not None:
            tail = tail[: idx + 1]
    tail = [e for e in tail if e.get("type") != "progress" and not e.get("isSidechain")]
    if not tail or not is_turn_start(tail[0]):
        raise ValueError("切口后面第一条不是她说的话")
    new_sid = str(uuid_mod.uuid4())
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    first_ts = tail[0].get("timestamp") or now
    tmpl_u = next((e for e in tail if e.get("type") == "user"), tail[0])
    tmpl_a = next((e for e in chain if e.get("type") == "assistant"), None)
    u_id, a_id = str(uuid_mod.uuid4()), str(uuid_mod.uuid4())
    out = []
    su = {**_clean(tmpl_u), "type": "user", "uuid": u_id, "parentUuid": None, "sessionId": new_sid, "timestamp": first_ts,
          "isSidechain": False, "isMeta": False, "message": {"role": "user", "content": summary_text}, "zxkSlide": "summary",
          "slidFrom": {"sessionId": old_sid}}
    out.append(su)
    am = dict((tmpl_a or {}).get("message") or {})
    am.update({"id": "msg_slide_" + uuid_mod.uuid4().hex[:20], "type": "message", "role": "assistant",
               "content": [{"type": "text", "text": "收好了。往下接着聊。"}], "stop_reason": "end_turn", "stop_sequence": None,
               "usage": {"input_tokens": 0, "output_tokens": 0}})
    am.setdefault("model", "claude")
    sa = {**_clean(tmpl_a or tmpl_u), "type": "assistant", "uuid": a_id, "parentUuid": u_id, "sessionId": new_sid,
          "timestamp": first_ts, "isSidechain": False, "message": am, "zxkSlide": "ack"}
    sa.pop("isMeta", None)
    out.append(sa)
    mapping = {e["uuid"]: str(uuid_mod.uuid4()) for e in tail}
    prev = a_id
    for i, e in enumerate(tail):
        p = e.get("parentUuid")
        # 第一条接在「收好了」后面；后面的按原来的父子关系接（父不在这一段里的话，接在前一条后面）
        parent = a_id if i == 0 else (mapping.get(p) or prev)
        ne = {**e, "uuid": mapping[e["uuid"]], "parentUuid": parent, "sessionId": new_sid, "isSidechain": False}
        for k in ("teamName", "agentName", "slug", "forkedFrom", "logicalParentUuid"):
            ne.pop(k, None)
        if i == len(tail) - 1:
            ne["timestamp"] = now
        out.append(ne)
        prev = ne["uuid"]
    lines = [json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in out]
    if replacements:
        lines.append(json.dumps({"type": "content-replacement", "sessionId": new_sid, "replacements": replacements,
                                 "uuid": str(uuid_mod.uuid4()), "timestamp": now}, ensure_ascii=False, separators=(",", ":")))
    if title:
        lines.append(json.dumps({"type": "custom-title", "sessionId": new_sid, "customTitle": title,
                                 "uuid": str(uuid_mod.uuid4()), "timestamp": now}, ensure_ascii=False, separators=(",", ":")))
    return new_sid, lines


def text_of(e: dict) -> str:
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    return " ".join(b.get("text", "") for b in c or [] if isinstance(b, dict) and b.get("type") == "text")
