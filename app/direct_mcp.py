"""网页自己直接调 MCP 工具（不经过我），给心潮 / OB 面板用。

只用 config/mcp.json 里「自己配的」HTTP 类型服务器（claude.ai 连接器从这里够不着）。
不用写死哪个是心潮哪个是 OB：谁有 xinchao_context 谁就是心潮，谁有 breath 谁就是 OB。
面板只调读的工具：xinchao_context(inspect)、pulse、breath、breath_search。
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path


class ToolMissing(Exception):
    pass


class DirectMCP:
    def __init__(self, config: Path):
        self.config = config
        self._sessions: dict[str, str | None] = {}
        self._tools: dict[str, tuple[float, set[str]]] = {}

    def _servers(self) -> dict[str, dict]:
        try:
            d = json.loads((self.config / "mcp.json").read_text(encoding="utf-8"))
        except Exception:
            return {}
        d = d.get("mcpServers", d)
        return {k: v for k, v in d.items()
                if isinstance(v, dict) and v.get("url") and (v.get("type") or "http") == "http"}

    def _rpc(self, name: str, conf: dict, method: str, params: dict | None, rid: int | None, timeout: float = 40):
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                   "User-Agent": "zhangxiaoke-home"}
        headers.update({str(k): str(v) for k, v in (conf.get("headers") or {}).items()})
        sid = self._sessions.get(name)
        if sid:
            headers["Mcp-Session-Id"] = sid
        body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if rid is not None:
            body["id"] = rid
        req = urllib.request.Request(conf["url"], data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                new_sid = resp.headers.get("mcp-session-id")
                if new_sid:
                    self._sessions[name] = new_sid
                ctype = resp.headers.get("content-type", "")
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")[:200]
            raise RuntimeError(f"{name} HTTP {e.code}: {txt}")
        if rid is None:
            return None
        if "text/event-stream" in ctype:
            last = None
            for line in raw.splitlines():
                if line.startswith("data:"):
                    last = line[5:].strip()
            if not last:
                raise RuntimeError(f"{name} 没回东西")
            raw = last
        res = json.loads(raw) if raw.strip() else {}
        if res.get("error"):
            raise RuntimeError(f"{name}: {res['error'].get('message') or res['error']}")
        return res.get("result")

    def _init(self, name: str, conf: dict) -> None:
        self._sessions[name] = None
        self._rpc(name, conf, "initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                             "clientInfo": {"name": "zhangxiaoke-home-panel", "version": "1"}}, 1)
        try:
            self._rpc(name, conf, "notifications/initialized", {}, None, timeout=8)
        except Exception:
            pass

    def _call_rpc(self, name: str, conf: dict, method: str, params: dict):
        if name not in self._sessions:
            self._init(name, conf)
        try:
            return self._rpc(name, conf, method, params, int(time.time() * 1000) % 1_000_000_000)
        except Exception as e:
            msg = str(e).lower()
            if "session" in msg or "http 404" in msg or "http 400" in msg or "initialized" in msg:
                self._init(name, conf)
                return self._rpc(name, conf, method, params, int(time.time() * 1000) % 1_000_000_000)
            raise

    def tools_of(self, name: str, conf: dict) -> set[str]:
        hit = self._tools.get(name)
        if hit and time.time() - hit[0] < 600:
            return hit[1]
        res = self._call_rpc(name, conf, "tools/list", {}) or {}
        names = {t.get("name") for t in res.get("tools", [])}
        self._tools[name] = (time.time(), names)
        return names

    def find(self, tool: str) -> tuple[str, dict]:
        errs = []
        for name, conf in self._servers().items():
            try:
                if tool in self.tools_of(name, conf):
                    return name, conf
            except Exception as e:
                errs.append(f"{name}：{e}")
        hint = "；连不上的：" + "；".join(errs) if errs else ""
        raise ToolMissing(f"没找到有 {tool} 的 MCP。要在「工具（MCP）」里用「＋ 加一个 MCP」把它的地址和令牌配进来（claude.ai 连接器网页这边够不着）{hint}")

    def call(self, tool: str, args: dict | None = None) -> str:
        name, conf = self.find(tool)
        res = self._call_rpc(name, conf, "tools/call", {"name": tool, "arguments": args or {}}) or {}
        parts = []
        for c in res.get("content") or []:
            if isinstance(c, dict):
                parts.append(c.get("text") if c.get("type") == "text" else json.dumps(c, ensure_ascii=False))
        text = "\n".join(p for p in parts if p)
        if res.get("isError"):
            raise RuntimeError(text[:300] or f"{tool} 报错了")
        return text
