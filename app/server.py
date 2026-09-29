"""章小克的家 —— 自建前端的后端。

一个人用的聊天服务：密码登录 → 网页发消息 → 用订阅登录的 Claude Code（Agent SDK）回复，
流式推回网页。会话 id 存在 data/state.json，关掉网页再打开还能接着聊。

配置（全部在服务器上，不进仓库）：
  .env                     APP_PASSWORD / SECRET_KEY / 可选 MODEL、ALLOW_SHELL、EFFORT
  config/system_prompt.md  系统提示词（「章小克 | 醒了」那份）
  config/mcp.json          要接的 MCP 服务器
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    get_session_messages,
    query,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
STATIC = ROOT / "static"
WORKDIR = Path(os.environ.get("WORKDIR", str(ROOT / "workspace")))
DATA.mkdir(exist_ok=True)
WORKDIR.mkdir(parents=True, exist_ok=True)


def _load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
SECRET_KEY = os.environ.get("SECRET_KEY", "")
MODEL = os.environ.get("MODEL") or None
EFFORT = os.environ.get("EFFORT") or None
ALLOW_SHELL = os.environ.get("ALLOW_SHELL", "0") == "1"
TZ = ZoneInfo(os.environ.get("TZ_NAME", "Asia/Shanghai"))
COOKIE = "home_auth"
COOKIE_DAYS = 30

if not APP_PASSWORD or not SECRET_KEY:
    raise SystemExit("缺少 APP_PASSWORD 或 SECRET_KEY，先在 .env 里设好。")

# ── 状态 ────────────────────────────────────────────────────────────

STATE_FILE = DATA / "state.json"


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


# ── 登录 ────────────────────────────────────────────────────────────


def _sign(expires: int) -> str:
    mac = hmac.new(SECRET_KEY.encode(), f"ok:{expires}".encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{mac}"


def _authed(request: Request) -> bool:
    raw = request.cookies.get(COOKIE, "")
    try:
        exp_s, mac = raw.split(".", 1)
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < time.time():
        return False
    return hmac.compare_digest(_sign(exp), raw)


def require_auth(request: Request) -> None:
    if not _authed(request):
        raise HTTPException(401, "未登录")


_fail_log: list[float] = []


# ── Agent 配置 ──────────────────────────────────────────────────────


def _system_prompt() -> str:
    p = CONFIG / "system_prompt.md"
    base = p.read_text(encoding="utf-8") if p.exists() else "你是章小克。"
    now = datetime.now(TZ).strftime("%Y-%m-%d %A %H:%M")
    extra = (
        "\n\n---\n"
        f"此刻：{now}（Ella 所在时区 {TZ.key}）。\n"
        "你现在在 Ella 自己搭的网页里，跑在她东京的服务器上。"
        "回复用中文，除非她先用别的语言。"
    )
    return base + extra


def _mcp_servers() -> dict:
    p = CONFIG / "mcp.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[warn] config/mcp.json 格式不对：{e}")
        return {}
    return data.get("mcpServers", data)


def _options(resume: str | None) -> ClaudeAgentOptions:
    disallowed = [] if ALLOW_SHELL else ["Bash", "Write", "Edit", "NotebookEdit", "KillShell"]
    kw = dict(
        system_prompt=_system_prompt(),
        mcp_servers=_mcp_servers(),
        permission_mode="bypassPermissions",
        disallowed_tools=disallowed,
        cwd=str(WORKDIR),
        include_partial_messages=True,
        setting_sources=[],
        resume=resume,
    )
    if MODEL:
        kw["model"] = MODEL
    if EFFORT:
        kw["effort"] = EFFORT
    return ClaudeAgentOptions(**kw)


# ── App ─────────────────────────────────────────────────────────────

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_turn_lock = asyncio.Lock()


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.post("/api/login")
async def login(request: Request, response: Response):
    now = time.time()
    _fail_log[:] = [t for t in _fail_log if now - t < 600]
    if len(_fail_log) >= 8:
        raise HTTPException(429, "试错太多次了，十分钟后再来")
    body = await request.json()
    if not hmac.compare_digest(str(body.get("password", "")), APP_PASSWORD):
        _fail_log.append(now)
        await asyncio.sleep(1)
        raise HTTPException(401, "密码不对")
    exp = int(now) + COOKIE_DAYS * 86400
    response.set_cookie(
        COOKIE, _sign(exp), max_age=COOKIE_DAYS * 86400,
        httponly=True, secure=True, samesite="strict",
    )
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request):
    return {"authed": _authed(request)}


def _text_of(content) -> tuple[str, list[str]]:
    if isinstance(content, str):
        return content, []
    texts, tools = [], []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            texts.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            tools.append(b.get("name", ""))
    return "\n".join(t for t in texts if t), tools


@app.get("/api/history")
async def history(request: Request):
    require_auth(request)
    sid = load_state().get("session_id")
    if not sid:
        return {"session_id": None, "messages": []}
    try:
        raw = get_session_messages(sid, directory=str(WORKDIR))
    except Exception as e:  # 会话文件丢了之类
        return {"session_id": sid, "messages": [], "warning": str(e)}
    out: list[dict] = []
    for m in raw:
        msg = m.message or {}
        text, tools = _text_of(msg.get("content"))
        if m.type == "user":
            if not text:  # 纯工具结果，不显示
                continue
            out.append({"role": "user", "text": text})
        else:
            if out and out[-1]["role"] == "assistant":
                last = out[-1]
                if text:
                    last["text"] = (last["text"] + "\n\n" + text).strip()
                last["tools"] += tools
            else:
                out.append({"role": "assistant", "text": text, "tools": tools})
    return {"session_id": sid, "messages": out}


@app.post("/api/new")
async def new_window(request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    state = load_state()
    if state.get("session_id"):
        state.setdefault("past_sessions", []).append(
            {"id": state["session_id"], "closed": datetime.now(TZ).isoformat()}
        )
    state["session_id"] = None
    save_state(state)
    return {"ok": True}


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/api/chat")
async def chat(request: Request):
    require_auth(request)
    body = await request.json()
    text = str(body.get("text", "")).strip()
    if not text:
        raise HTTPException(400, "空消息")
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")

    async def run():
        async with _turn_lock:
            state = load_state()
            sid = state.get("session_id")
            try:
                async for msg in query(prompt=text, options=_options(sid)):
                    if isinstance(msg, StreamEvent):
                        ev = msg.event
                        if ev.get("type") == "content_block_delta":
                            d = ev.get("delta", {})
                            if d.get("type") == "text_delta":
                                yield _sse({"type": "text", "text": d.get("text", "")})
                        elif ev.get("type") == "content_block_start":
                            cb = ev.get("content_block", {})
                            if cb.get("type") == "tool_use":
                                yield _sse({"type": "tool", "name": cb.get("name", "")})
                            elif cb.get("type") == "text":
                                yield _sse({"type": "block"})
                    elif isinstance(msg, SystemMessage):
                        new_sid = (msg.data or {}).get("session_id")
                        if new_sid and new_sid != sid:
                            state["session_id"] = new_sid
                            save_state(state)
                    elif isinstance(msg, ResultMessage):
                        state["session_id"] = msg.session_id
                        state["last_turn"] = datetime.now(TZ).isoformat()
                        save_state(state)
                        if msg.is_error:
                            yield _sse({"type": "error", "text": "; ".join(msg.errors or [msg.subtype])})
                        yield _sse({"type": "done"})
            except Exception as e:
                yield _sse({"type": "error", "text": f"{type(e).__name__}: {e}"})
                yield _sse({"type": "done"})

    return StreamingResponse(
        run(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True})
