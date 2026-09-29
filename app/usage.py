"""订阅用量：5 小时窗口、每周窗口用了多少。

主来源：Claude Code 自己的 /usage 用的查询（用这台机器上登录的订阅令牌，只查自己的账号）。
这个接口 Anthropic 没有公开写进文档，哪天变了就会拿不到，拿不到时退回备用来源。
备用来源：对话过程中 Claude Code 发来的限流事件（通常只有状态和重置时间，接近上限时才有百分比）。
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
LABELS = {
    "five_hour": "5小时",
    "seven_day": "本周",
    "seven_day_opus": "本周 Opus",
    "seven_day_sonnet": "本周 Sonnet",
}


def _iso_to_ts(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


class Usage:
    def __init__(self):
        self.cache: dict | None = None
        self.cache_at = 0.0
        self.events: dict[str, dict] = {}  # 从限流事件里记下来的

    def note_event(self, info) -> None:
        kind = info.rate_limit_type or "five_hour"
        self.events[kind] = {
            "status": info.status,
            "pct": round(info.utilization * 100) if info.utilization is not None else None,
            "resets_at": info.resets_at,
        }
        self.cache_at = 0  # 状态变了，下次重新查

    def _token(self) -> str | None:
        p = Path.home() / ".claude" / ".credentials.json"
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            return (d.get("claudeAiOauth") or {}).get("accessToken")
        except Exception:
            return None

    def _fetch(self) -> dict:
        tok = self._token()
        if not tok:
            raise RuntimeError("这台机器上没找到订阅登录信息")
        r = urllib.request.Request(USAGE_URL, headers={
            "Authorization": f"Bearer {tok}",
            "anthropic-beta": "oauth-2025-04-20",
            "Content-Type": "application/json",
            "User-Agent": "claude-code",
        })
        with urllib.request.urlopen(r, timeout=15) as resp:
            return json.loads(resp.read())

    def _merge(self, raw: dict | None) -> dict:
        windows = []
        seen = set()
        for key, label in LABELS.items():
            w = (raw or {}).get(key)
            ev = self.events.get(key)
            if isinstance(w, dict) and w.get("utilization") is not None:
                pct = w["utilization"]
                pct = round(pct * 100) if pct <= 1 else round(pct)  # 兼容 0-1 和 0-100 两种写法
                windows.append({"key": key, "label": label, "pct": pct,
                                "resets_at": _iso_to_ts(w.get("resets_at")),
                                "status": (ev or {}).get("status")})
                seen.add(key)
            elif ev:
                windows.append({"key": key, "label": label, **ev})
                seen.add(key)
        return {"windows": windows, "source": "oauth" if raw else ("events" if windows else None)}

    async def get(self, force: bool = False) -> dict:
        if not force and self.cache and time.time() - self.cache_at < 90:
            return self.cache
        raw, err = None, None
        try:
            raw = await asyncio.to_thread(self._fetch)
        except urllib.error.HTTPError as e:
            err = f"查询被拒（HTTP {e.code}）" + ("，订阅登录可能过期了，跟我说一句话就会刷新" if e.code == 401 else "")
        except Exception as e:
            err = str(e)
        out = self._merge(raw)
        out["error"] = err
        out["at"] = int(time.time())
        self.cache, self.cache_at = out, time.time()
        return out
