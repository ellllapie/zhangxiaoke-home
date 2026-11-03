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


# 11-03 晚：聊天里的语音条用 ElevenLabs 的小维（跟电话同一个声音、同一套设置，每次现读 voice.env，
# 电话那边换了声音这边跟着换）。电话要压成 16k，语音条不压，直接拿 44.1k mp3。
ELEVEN = "eleven"
VOICE_ENV = Path.home() / ".config/ringringring/voice.env"


def _env() -> dict:
    out = {}
    try:
        for line in VOICE_ENV.read_text(encoding="utf-8").splitlines():
            m = re.match(r'^\s*(?:export\s+)?([A-Z_]+)="?([^"]*)"?\s*$', line)
            if m:
                out[m.group(1)] = m.group(2)
    except OSError:
        pass
    return out


def eleven_cfg() -> dict:
    e = _env()
    return {
        "key": e.get("ELEVENLABS_API_KEY", ""),
        "voice": e.get("XIAOKE_VOICE_ID") or "GoV1V2hQd1doxcYR2SuA",
        "model": e.get("XIAOKE_MODEL") or "eleven_multilingual_v2",
        "stability": float(e.get("XIAOKE_STABILITY") or 0.5),
        "similarity_boost": float(e.get("XIAOKE_SIMILARITY") or 0.75),
        "style": float(e.get("XIAOKE_STYLE") or 0),
        "speed": float(e.get("XIAOKE_SPEED") or 1.0),
    }


def cache_voice(voice: str) -> str:
    """缓存用的声音名：eleven 带上声音 ID 和设置，换了声音不会拿到旧的。"""
    if voice != ELEVEN:
        return voice
    c = eleven_cfg()
    return "eleven:" + "|".join(str(c[k]) for k in ("voice", "model", "stability", "similarity_boost", "style", "speed"))


def _eleven(text: str, out: Path) -> None:
    import json
    import urllib.request
    c = eleven_cfg()
    if not c["key"]:
        raise RuntimeError("voice.env 里没有 ElevenLabs 的 key")
    body = json.dumps({"text": text, "model_id": c["model"], "voice_settings": {
        k: c[k] for k in ("stability", "similarity_boost", "style", "speed")}}).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{c['voice']}?output_format=mp3_44100_128",
        data=body, headers={"xi-api-key": c["key"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out.write_bytes(r.read())


async def synth(text: str, voice: str, out_dir: Path) -> Path:
    """合成（或拿缓存），返回 mp3 路径。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    if voice == ELEVEN:
        import asyncio
        p = out_dir / f"{key(text, cache_voice(voice))}.mp3"
        if p.exists() and p.stat().st_size > 0:
            return p
        tmp = p.with_suffix(".part")
        await asyncio.to_thread(_eleven, text, tmp)
        tmp.replace(p)
        return p

    import edge_tts  # 晚点再 import：没装也不影响新家其他功能

    p = out_dir / f"{key(text, voice)}.mp3"
    if p.exists() and p.stat().st_size > 0:
        return p
    tmp = p.with_suffix(".part")
    await edge_tts.Communicate(text, voice).save(str(tmp))
    tmp.replace(p)
    return p
