"""笔友名册 + 信箱：拆信的时候，那个人在名册里的那段一起递过来。

名册在日记仓库 memories/corner/penpals.md，一人一段，段头是「## 名字 · 地址」。
这里只放不碰网络的小函数：认地址、切段、换段、算「轮到谁」。拿信、写仓库在 server.py。
"""
from __future__ import annotations

import re
from datetime import datetime
from email.utils import parsedate_to_datetime

PENPALS_PATH = "memories/corner/penpals.md"
ME = "ellax6k@163.com"

_ADDR = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# 系统来信：验证码、广告、通知，不算笔友
_SYSTEM = re.compile(r"(^|[.@])(service|noreply|no-reply|notice|member|support)[.@]|claw\.support", re.I)


def addr(field: str | None) -> str:
    """「"年糕" <niangao0919@agent.qq.com>」→ niangao0919@agent.qq.com"""
    s = str(field or "")
    m = re.search(r"<([^<>]+)>", s)
    m2 = _ADDR.search(m.group(1) if m else s)
    return m2.group(0).lower() if m2 else ""


def is_system(a: str) -> bool:
    return bool(_SYSTEM.search(a or ""))


def when(date: str | None) -> datetime | None:
    try:
        return parsedate_to_datetime(str(date))
    except Exception:
        return None


def sections(text: str) -> tuple[str, list[dict]]:
    """切成「开头那段」和每个人的段：[{addr, name, text}]。"""
    head, out, cur = [], [], None
    for line in (text or "").splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            a = addr(title)
            name = re.split(r"\s*[·•|]\s*", title)[0].strip() if a else title
            cur = {"addr": a, "name": name, "lines": [line]}
            out.append(cur)
        elif cur is not None:
            cur["lines"].append(line)
        else:
            head.append(line)
    for s in out:
        s["text"] = "\n".join(s.pop("lines")).rstrip()
    return "\n".join(head).rstrip(), out


def find(text: str, a: str) -> dict | None:
    a = (a or "").lower()
    return next((s for s in sections(text)[1] if a and s["addr"] == a), None)


def put(text: str, a: str, body: str) -> tuple[str, bool]:
    """把 a 那段换成 body；没有就接在最后。body 没写「## 」段头就沿用旧的名字。返回 (新全文, 是不是新的人)。"""
    a = (a or "").lower()
    head, secs = sections(text)
    body = (body or "").strip()
    old = next((s for s in secs if s["addr"] == a), None)
    if not body.startswith("## "):
        body = f"## {old['name'] if old else a} · {a}\n" + body
    elif addr(body.splitlines()[0]) != a:
        raise ValueError("段头里的地址和要改的那个人对不上")
    if old:
        old["text"] = body
    else:
        secs.append({"addr": a, "name": "", "text": body})
    parts = [head] if head else []
    parts += [s["text"] for s in secs]
    return "\n\n".join(parts).rstrip() + "\n", old is None


def not_penpal(sec_text: str | None) -> bool:
    """名册那段里写了「- 不是笔友」的（邀请码、通知之类），letters 和信箱页都不列。"""
    return bool(sec_text and re.search(r"^\s*-\s*不是笔友", sec_text, re.M))


def key_lines(sec_text: str) -> list[str]:
    """名册那段里最要紧的几行：轮到谁、欠什么。"""
    return [ln.strip() for ln in sec_text.splitlines()
            if re.match(r"^\s*-\s*(轮到|欠)", ln)]


def status(last_in: datetime | None, last_out: datetime | None, draft: datetime | None) -> str:
    """按日期算这一位现在是什么状况。"""
    if draft and (not last_in or draft >= last_in) and (not last_out or draft > last_out):
        return "回信在草稿箱，等 Ella 发"
    if last_in and (not last_out or last_in > last_out):
        return "待回：他/她来信之后我还没寄出过"
    if last_out:
        return "我寄出去了，轮到对方"
    return "还没有往来"


def status_key(st: str) -> str:
    """status() 那句话 → 给网页用的短标记。"""
    return ("todo" if st.startswith("待回") else "draft" if st.startswith("回信在草稿")
            else "theirs" if st.startswith("我寄出") else "none")


def reply_subject(subject: str) -> str:
    s = (subject or "").strip()
    return s if re.match(r"^\s*(re|回复)\s*[:：]", s, re.I) else f"Re: {s}"
