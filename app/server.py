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
import re
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
    ClaudeSDKClient,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    get_session_messages,
    list_sessions,
)

from app.backup import Backup

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
THINKING = os.environ.get("THINKING", "summarized")  # summarized / omitted / off
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
    extra = (
        "\n\n---\n"
        f"Ella 所在时区 {TZ.key}。她每条消息开头的【此刻 …】是网页自动加的："
        "当前时间、距她上一条消息多久、距你上次回完多久。不是她打的字。\n"
        "你现在在 Ella 自己搭的网页里，跑在她东京的服务器上。"
        "回复用中文，除非她先用别的语言。"
    )
    return base + extra


TIME_TAG = re.compile(r"^【此刻 [^】]*】\n?")


def _dur(seconds: float) -> str:
    s = int(seconds)
    if s < 60:
        return "不到一分钟"
    m = s // 60
    if m < 60:
        return f"{m}分钟"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h}小时{m}分" if m else f"{h}小时"
    d, h = divmod(h, 24)
    return f"{d}天{h}小时" if h else f"{d}天"


def _stamp(text: str, state: dict) -> str:
    now = datetime.now(TZ)
    parts = [now.strftime("%Y-%m-%d %a %H:%M")]
    for key, label in (("last_user_at", "距她上一条"), ("last_reply_at", "距你上次回完")):
        t = state.get(key)
        if t:
            try:
                parts.append(f"{label} {_dur((now - datetime.fromisoformat(t)).total_seconds())}")
            except ValueError:
                pass
    return f"【此刻 {' · '.join(parts)}】\n{text}"


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
    if THINKING in ("summarized", "omitted"):
        kw["thinking"] = {"type": "adaptive", "display": THINKING}
    if MODEL:
        kw["model"] = MODEL
    if EFFORT:
        kw["effort"] = EFFORT
    return ClaudeAgentOptions(**kw)


# ── App ─────────────────────────────────────────────────────────────

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_turn_lock = asyncio.Lock()
backup = Backup(ROOT, DATA, WORKDIR, CONFIG)

# ── 常驻的 Claude Code 连接 ─────────────────────────────────────────
# 不再每句话重启一次：连一次，一直用。换窗口、出错、改配置重启服务时才重连。

_client: ClaudeSDKClient | None = None
_client_sid: str | None = None  # 这个连接对应的会话；None = 还没说过话的新窗口
_client_lock = asyncio.Lock()


async def _drop_client() -> None:
    global _client, _client_sid
    c, _client, _client_sid = _client, None, None
    if c is not None:
        try:
            await c.disconnect()
        except Exception:
            pass


async def _get_client(sid: str | None) -> ClaudeSDKClient:
    global _client, _client_sid
    async with _client_lock:
        if _client is not None and _client_sid == sid:
            return _client
        await _drop_client()
        c = ClaudeSDKClient(options=_options(sid))
        await c.connect()
        _client, _client_sid = c, sid
        return c


async def _warm() -> None:
    """打开网页时先把连接热起来，第一句就不用等开机。"""
    if _turn_lock.locked():
        return
    try:
        await _get_client(load_state().get("session_id"))
    except Exception as e:
        print(f"[warm] {type(e).__name__}: {e}")


@app.on_event("startup")
async def _startup():
    asyncio.create_task(backup.loop())


@app.on_event("shutdown")
async def _shutdown():
    await _drop_client()


@app.get("/")
async def index():
    # 不让浏览器缓存页面，更新后刷新就是新的
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache, must-revalidate"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


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


# ── 历史：把会话记录还原成网页上的样子 ──────────────────────────────

MAX_RESULT = 200_000


def _result_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        out = content
    else:
        bits = []
        for b in content:
            if isinstance(b, dict):
                if b.get("type") == "text":
                    bits.append(b.get("text", ""))
                elif b.get("type") == "image":
                    bits.append("[图片]")
                else:
                    bits.append(json.dumps(b, ensure_ascii=False))
        out = "\n".join(bits)
    if len(out) > MAX_RESULT:
        out = out[:MAX_RESULT] + f"\n…（太长了，后面还有 {len(out) - MAX_RESULT} 个字没显示）"
    return out


def _history_from(raw) -> list[dict]:
    out: list[dict] = []
    tools: dict[str, dict] = {}

    def cur_assistant() -> dict:
        if not out or out[-1]["role"] != "assistant":
            out.append({"role": "assistant", "segs": []})
        return out[-1]

    for m in raw:
        content = (m.message or {}).get("content")
        if m.type == "user":
            if isinstance(content, str):
                out.append({"role": "user", "text": TIME_TAG.sub("", content), "images": []})
                continue
            texts, images = [], []
            for b in content or []:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "tool_result":
                    seg = tools.get(b.get("tool_use_id"))
                    if seg is not None:
                        seg["result"] = _result_text(b.get("content"))
                        seg["error"] = bool(b.get("is_error"))
                elif t == "text":
                    texts.append(b.get("text", ""))
                elif t == "image":
                    src = b.get("source") or {}
                    if src.get("type") == "base64":
                        images.append(f"data:{src.get('media_type')};base64,{src.get('data')}")
            if texts or images:
                out.append({"role": "user", "text": TIME_TAG.sub("", "\n".join(texts)), "images": images})
        else:
            a = cur_assistant()
            for b in content or []:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "thinking" and b.get("thinking"):
                    a["segs"].append({"kind": "thinking", "text": b["thinking"]})
                elif t == "text" and b.get("text"):
                    a["segs"].append({"kind": "text", "text": b["text"]})
                elif t == "tool_use":
                    seg = {"kind": "tool", "id": b.get("id"), "name": b.get("name", ""),
                           "input": b.get("input"), "result": None, "error": False}
                    tools[seg["id"]] = seg
                    a["segs"].append(seg)
    return out


@app.get("/api/history")
async def history(request: Request):
    require_auth(request)
    asyncio.create_task(_warm())
    sid = load_state().get("session_id")
    if not sid:
        return {"session_id": None, "messages": []}
    try:
        raw = get_session_messages(sid, directory=str(WORKDIR))
    except Exception as e:  # 会话文件丢了之类
        return {"session_id": sid, "messages": [], "warning": str(e)}
    return {"session_id": sid, "messages": _history_from(raw)}


@app.get("/api/sessions")
async def sessions(request: Request):
    require_auth(request)
    state = load_state()
    closed = {p["id"]: p.get("closed") for p in state.get("past_sessions", [])}
    out = []
    try:
        infos = list_sessions(directory=str(WORKDIR))
    except Exception:
        infos = []
    for i in infos:
        first = TIME_TAG.sub("", i.first_prompt or "").strip()
        out.append({
            "id": i.session_id,
            "title": state.get("titles", {}).get(i.session_id) or first[:40] or "（只有图片）",
            "created": i.created_at, "updated": i.last_modified,
            "current": i.session_id == state.get("session_id"),
            "closed": closed.get(i.session_id),
        })
    out.sort(key=lambda x: x["updated"] or 0, reverse=True)
    return {"sessions": out, "current": state.get("session_id")}


@app.get("/api/sessions/{sid}")
async def session_detail(sid: str, request: Request):
    require_auth(request)
    if not re.fullmatch(r"[0-9a-f-]{36}", sid):
        raise HTTPException(400, "不对的窗口编号")
    try:
        raw = get_session_messages(sid, directory=str(WORKDIR))
    except Exception as e:
        raise HTTPException(404, f"找不到这个窗口：{e}")
    return {"session_id": sid, "messages": _history_from(raw)}


@app.post("/api/switch")
async def switch(request: Request):
    """回到以前的某个窗口接着聊。"""
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    sid = str((await request.json()).get("id", ""))
    if not re.fullmatch(r"[0-9a-f-]{36}", sid):
        raise HTTPException(400, "不对的窗口编号")
    state = load_state()
    cur = state.get("session_id")
    if cur and cur != sid:
        state.setdefault("past_sessions", []).append({"id": cur, "closed": datetime.now(TZ).isoformat()})
    state["past_sessions"] = [p for p in state.get("past_sessions", []) if p["id"] != sid]
    state["session_id"] = sid
    save_state(state)
    await _drop_client()
    asyncio.create_task(_warm())
    return {"ok": True}


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
    await _drop_client()
    asyncio.create_task(_warm())
    backup.soon(5)
    return {"ok": True}


@app.post("/api/stop")
async def stop(request: Request):
    require_auth(request)
    if _client is not None and _turn_lock.locked():
        try:
            await _client.interrupt()
        except Exception as e:
            return {"ok": False, "detail": str(e)}
    return {"ok": True}


@app.get("/api/backup")
async def backup_status(request: Request):
    require_auth(request)
    return backup.last


@app.post("/api/backup")
async def backup_now(request: Request):
    require_auth(request)
    return await backup.run()


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


ALLOWED_IMG = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGES = 6
MAX_IMG_B64 = 7_000_000  # 约 5MB 的图


def _user_payload(text: str, images: list[dict], state: dict, sid: str | None):
    content: list[dict] = []
    for img in images[:MAX_IMAGES]:
        mt, data = img.get("media_type"), img.get("data", "")
        if mt in ALLOWED_IMG and data and len(data) <= MAX_IMG_B64:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mt, "data": data}})
    content.append({"type": "text", "text": _stamp(text or "（发了图）", state)})

    async def gen():
        yield {"type": "user", "message": {"role": "user", "content": content},
               "parent_tool_use_id": None, "session_id": sid or "default"}

    return gen()


@app.post("/api/chat")
async def chat(request: Request):
    require_auth(request)
    body = await request.json()
    text = str(body.get("text", "")).strip()
    images = body.get("images") or []
    if not isinstance(images, list):
        images = []
    if not text and not images:
        raise HTTPException(400, "空消息")
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")

    async def one_turn(state: dict, sid: str | None):
        global _client_sid
        client = await _get_client(sid)
        await client.query(_user_payload(text, images, state, sid))
        state["last_user_at"] = datetime.now(TZ).isoformat()
        save_state(state)
        async for msg in client.receive_response():
            if isinstance(msg, StreamEvent):
                ev = msg.event
                et = ev.get("type")
                if et == "content_block_start":
                    cb = ev.get("content_block", {})
                    kind = cb.get("type")
                    if kind == "tool_use":
                        yield {"type": "tool_start", "id": cb.get("id"), "name": cb.get("name", "")}
                    elif kind in ("text", "thinking"):
                        yield {"type": "seg", "kind": kind}
                elif et == "content_block_delta":
                    d = ev.get("delta", {})
                    if d.get("type") == "text_delta":
                        yield {"type": "text", "text": d.get("text", "")}
                    elif d.get("type") == "thinking_delta":
                        yield {"type": "thinking", "text": d.get("thinking", "")}
            elif isinstance(msg, AssistantMessage):
                for b in msg.content:
                    if isinstance(b, ToolUseBlock):
                        yield {"type": "tool_input", "id": b.id, "name": b.name, "input": b.input}
            elif isinstance(msg, UserMessage):
                if isinstance(msg.content, list):
                    for b in msg.content:
                        if isinstance(b, ToolResultBlock):
                            yield {"type": "tool_result", "id": b.tool_use_id,
                                   "result": _result_text(b.content), "error": bool(b.is_error)}
            elif isinstance(msg, SystemMessage):
                new_sid = (msg.data or {}).get("session_id")
                if new_sid and new_sid != state.get("session_id"):
                    state["session_id"] = new_sid
                    save_state(state)
                    _client_sid = new_sid
            elif isinstance(msg, ResultMessage):
                state["session_id"] = msg.session_id
                state["last_reply_at"] = datetime.now(TZ).isoformat()
                save_state(state)
                _client_sid = msg.session_id
                if msg.is_error and msg.subtype != "error_during_execution":
                    yield {"type": "error", "text": "; ".join(msg.errors or [msg.subtype])}

    async def run():
        async with _turn_lock:
            state = load_state()
            sid = state.get("session_id")
            sent_any = False
            for attempt in (1, 2):
                try:
                    async for ev in one_turn(state, sid):
                        sent_any = True
                        yield _sse(ev)
                    break
                except Exception as e:
                    await _drop_client()
                    if attempt == 1 and not sent_any:
                        continue  # 连接坏了，换个新连接再试一次
                    yield _sse({"type": "error", "text": f"{type(e).__name__}: {e}"})
                    break
            yield _sse({"type": "done"})
        backup.soon()

    return StreamingResponse(
        run(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True})
