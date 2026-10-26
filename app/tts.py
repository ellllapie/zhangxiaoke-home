"""新家电话 · 第一步：把一句话变成声音（edge-tts，免费）。

同一个声音念同一句话只合成一次：按 sha1(声音|文字) 存成 data/tts/<hash>.mp3，
下次直接拿缓存，不重复请求。跑通整条电话链路以后，再让 Ella 挑好的声音换掉。
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

DEFAULT_VOICE = "zh-CN-YunxiNeural"
MAX_CHARS = 300
NAME_RE = re.compile(r"[0-9a-f]{40}\.mp3")


def clean(text: str) -> str:
    """去掉网页里的文字特效和表情记号，留下要念出来的字。"""
    t = re.sub(r"\{图\|[^}]*\}", "", text or "")
    t = re.sub(r"\{心\|[^}]*\}", "", t)
    for _ in range(4):  # 特效可以套着写，剥几层
        t = re.sub(r"\{[^{}|]{1,3}\|([^{}]*)\}", r"\1", t)
    t = re.sub(r"~~(.*?)~~", "", t)
    t = re.sub(r"[*_`#>]", "", t)
    return re.sub(r"\s+", " ", t).strip()[:MAX_CHARS]


def key(text: str, voice: str) -> str:
    return hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()


async def synth(text: str, voice: str, out_dir: Path) -> Path:
    """合成（或拿缓存），返回 mp3 路径。"""
    import edge_tts  # 晚点再 import：没装也不影响新家其他功能

    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{key(text, voice)}.mp3"
    if p.exists() and p.stat().st_size > 0:
        return p
    tmp = p.with_suffix(".part")
    await edge_tts.Communicate(text, voice).save(str(tmp))
    tmp.replace(p)
    return p
