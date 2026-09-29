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
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    get_session_messages,
    list_sessions,
    rename_session,
)

try:  # 老版本 SDK 没有这个，就自己删文件
    from claude_agent_sdk import delete_session as _sdk_delete_session
except ImportError:
    _sdk_delete_session = None

from app.backup import Backup
from app.diary import Diary
from app.direct_mcp import DirectMCP, ToolMissing
from app.themes import Themes
from app.usage import Usage

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
        "回复用中文，除非她先用别的语言。\n"
        "想给她留话（她一打开网页，首页最上面就是这张留言条）：用 GitHub 工具改日记仓库的 "
        "memories/home/notes.md，在最上面加一段，格式是\n"
        "## 2026-09-29 14:51 · 从哪里（比如 新家、claude.ai、自动醒来）\n"
        "想说的话\n"
        "只加不删，旧的留着。\n"
        "她写给你的留言在同一个仓库的 memories/home/ella-notes.md（新的在最上面），醒来或者她提到的时候去看。"
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
    st = load_state()
    model = st.get("model") or MODEL
    effort = st.get("effort") or EFFORT
    if model:
        kw["model"] = model
    if effort:
        kw["effort"] = effort
    return ClaudeAgentOptions(**kw)


# ── App ─────────────────────────────────────────────────────────────

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_turn_lock = asyncio.Lock()
backup = Backup(ROOT, DATA, WORKDIR, CONFIG)
themes = Themes(DATA)
usage = Usage()
diary = Diary(backup._token)
direct = DirectMCP(CONFIG)
_panel_cache: dict[str, tuple[float, object]] = {}

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


def _session_exists(sid: str) -> bool:
    d = backup.sessions_dir()
    return (d / f"{sid}.jsonl").exists() if d.exists() else True


def _forget_session(sid: str) -> None:
    """记录丢了的会话：当前窗口指向它的话，换成新窗口。"""
    st = load_state()
    if st.get("session_id") == sid:
        st["session_id"] = None
        save_state(st)


async def _get_client(sid: str | None) -> ClaudeSDKClient:
    global _client, _client_sid
    async with _client_lock:
        if _client is not None and _client_sid == sid:
            return _client
        await _drop_client()
        if sid and not _session_exists(sid):
            print(f"[client] 会话 {sid} 的记录不在了，开一个新窗口")
            _forget_session(sid)
            sid = None
        c = ClaudeSDKClient(options=_options(sid))
        try:
            await c.connect()
        except Exception as e:
            if not sid or "no conversation found" not in str(e).lower():
                raise
            print(f"[client] 接不上会话 {sid}，开一个新窗口：{e}")
            try:
                await c.disconnect()
            except Exception:
                pass
            _forget_session(sid)
            sid = None
            c = ClaudeSDKClient(options=_options(None))
            await c.connect()
        for name in load_state().get("mcp_disabled", []):
            try:
                await c.toggle_mcp_server(name, False)
            except Exception:
                pass
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
    # 不让浏览器缓存页面，更新后刷新就是新的。
    # 状态栏颜色直接写进页面里：iPhone 只认页面一打开时的那个颜色，桌面版又和 Safari 不共用本地存储。
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    color = load_state().get("status_color")
    if color and re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        html = html.replace('<meta name="theme-color" content="#0b1a2b">', f'<meta name="theme-color" content="{color}">', 1)
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache, must-revalidate"})


@app.post("/api/status-color")
async def status_color(request: Request):
    require_auth(request)
    c = str((await request.json()).get("color", ""))
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", c):
        raise HTTPException(400, "颜色不对")
    st = load_state()
    if st.get("status_color") != c:
        st["status_color"] = c
        save_state(st)
    return {"ok": True}


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


CMD_ARGS = re.compile(r"<command-name>/model</command-name>.*?<command-args>(.*?)</command-args>", re.S)


def _command_note(text: str) -> str | None:
    """Claude Code 内部命令（比如换模型）留在记录里的东西：换模型变成一行小字，其余不显示。
    返回 None 表示这是普通消息。"""
    t = text.lstrip()
    if not t.startswith(("<command-", "<local-command")):
        return None
    m = CMD_ARGS.search(t)
    if m:
        arg = m.group(1).strip()
        return f"换成了 {arg or '默认模型'}"
    return ""


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
                note = _command_note(content)
                if note is not None:
                    if note:
                        out.append({"role": "note", "text": note})
                    continue
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
            if (m.message or {}).get("model"):
                a["model"] = m.message["model"]
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


@app.post("/api/sessions/{sid}/title")
async def session_title(sid: str, request: Request):
    require_auth(request)
    if not re.fullmatch(r"[0-9a-f-]{36}", sid):
        raise HTTPException(400, "不对的窗口编号")
    title = str((await request.json()).get("title", "")).strip()[:60]
    st = load_state()
    titles = st.setdefault("titles", {})
    if title:
        titles[sid] = title
    else:
        titles.pop(sid, None)
    save_state(st)
    try:
        rename_session(sid, title or "", directory=str(WORKDIR))
    except Exception:
        pass
    return {"ok": True, "title": title}


def _delete_one(sid: str) -> None:
    if _sdk_delete_session is not None:
        _sdk_delete_session(sid, directory=str(WORKDIR))
        return
    d = backup.sessions_dir()
    f = d / f"{sid}.jsonl"
    if not f.exists():
        raise FileNotFoundError(sid)
    f.unlink()
    import shutil
    shutil.rmtree(d / sid, ignore_errors=True)


@app.post("/api/sessions/delete")
async def sessions_delete(request: Request):
    """删掉一个或几个窗口。本机的记录删掉；GitHub 上 home-backup/ 里已经备份过的那份留着，后悔了还能找回。"""
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句，回完再删")
    ids = (await request.json()).get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "没选窗口")
    ids = [str(i) for i in ids][:200]
    if any(not re.fullmatch(r"[0-9a-f-]{36}", i) for i in ids):
        raise HTTPException(400, "不对的窗口编号")
    st = load_state()
    deleted, missing = [], []
    for sid in ids:
        try:
            _delete_one(sid)
            deleted.append(sid)
        except FileNotFoundError:
            missing.append(sid)  # 文件本来就没了，也当删掉
        except Exception as e:
            raise HTTPException(500, f"删到一半出错了：{e}")
    gone = set(deleted) | set(missing)
    st["past_sessions"] = [p for p in st.get("past_sessions", []) if p["id"] not in gone]
    for sid in gone:
        st.get("titles", {}).pop(sid, None)
    was_current = st.get("session_id") in gone
    if was_current:
        st["session_id"] = None
    save_state(st)
    if was_current or _client_sid in gone:
        await _drop_client()
        asyncio.create_task(_warm())
    return {"ok": True, "deleted": len(gone), "current_deleted": was_current}


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


@app.get("/api/home")
async def home_data(request: Request):
    """首页要的东西：留言条、最新日记、上次聊天时间。拿不到的就空着，不影响别的。"""
    require_auth(request)
    force = request.query_params.get("force") == "1"
    st = load_state()
    out = {"notes": [], "diary": None, "last_user_at": st.get("last_user_at"),
           "last_reply_at": st.get("last_reply_at"), "errors": []}
    try:
        out["notes"] = await asyncio.to_thread(diary.notes, force)
    except Exception as e:
        out["errors"].append(f"留言条：{e}")
    try:
        out["ella_notes"] = await asyncio.to_thread(diary.ella_notes, force)
    except Exception as e:
        out["ella_notes"] = []
        out["errors"].append(f"你的留言：{e}")
    try:
        out["diary"] = await asyncio.to_thread(diary.latest)
    except Exception as e:
        out["errors"].append(f"日记：{e}")
    return out


# ── 心潮 / OB 面板（网页直接调工具，只读） ──────────────────────────


def _unwrap(text: str) -> str:
    t = text.strip()
    if t.startswith("{"):
        try:
            d = json.loads(t)
            if isinstance(d, dict) and isinstance(d.get("result"), str):
                return d["result"]
        except json.JSONDecodeError:
            pass
    return text


async def _learn_connectors() -> bool:
    """问 Claude Code 要 claude.ai 连接器的真实地址，给面板直连用（只对不要令牌的有效）。"""
    try:
        c = _client if _turn_lock.locked() else await _get_client(load_state().get("session_id"))
        res = await c.get_mcp_status() if c else {}
    except Exception as e:
        print(f"[panel] 问不到连接器：{e}")
        return False
    extra = {}
    for sv in (res or {}).get("mcpServers", []):
        url = ((sv.get("config") or {}).get("url") or "").strip()
        if sv.get("scope") == "claudeai" and url.startswith("https://") and "api.anthropic.com" not in url:
            name = re.sub(r"[^A-Za-z0-9_-]+", "_", str(sv.get("name", "")).replace("claude.ai ", "")).strip("_") or "connector"
            extra[name] = {"type": "http", "url": url}
    changed = extra != direct.extra
    direct.extra = extra
    return changed and bool(extra)


async def _panel_call(key: str, tool: str, args: dict, ttl: float, force: bool = False):
    hit = _panel_cache.get(key)
    if hit and not force and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        try:
            text = await asyncio.to_thread(direct.call, tool, args)
        except ToolMissing:
            if not await _learn_connectors():
                raise
            text = await asyncio.to_thread(direct.call, tool, args)
    except ToolMissing as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    _panel_cache[key] = (time.time(), text)
    return text


@app.get("/api/xinchao")
async def xinchao(request: Request):
    require_auth(request)
    text = await _panel_call("xinchao", "xinchao_context", {"mode": "inspect", "max_tokens": 900}, 60,
                             request.query_params.get("force") == "1")
    try:
        d = json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}
    secs = {x.get("id"): x for x in d.get("sections", [])}
    dyn = secs.get("dynamic_state") or {}
    dream = (secs.get("dream_residue") or {}).get("content", "")
    dreams = []
    for line in dream.splitlines():
        if "｜" in line:
            at, txt = line.split("｜", 1)
            dreams.append({"at": at.strip(), "text": txt.strip()})
    letters = re.search(r"小屋[^，。]*?(\d+)\s*条她的来信", dyn.get("content", ""))
    return {"state": dyn.get("data") or {}, "summary": dyn.get("content", ""), "dreams": dreams,
            "cabin_letters": int(letters.group(1)) if letters else None,
            "generated_at": d.get("generatedAt"), "raw": d.get("additionalContext", "")}


PULSE_BUCKET = re.compile(r"^💭 \[(\w+)\] 《(.*?)》 主题:(\S*) 情感:V([\d.]+)/A([\d.]+) 重要:(\d+) 权重:([\d.]+)(?: 标签:(.*))?$")
PULSE_LETTER = re.compile(r"^(💌|🔒) \[(\w+)\] 《(.*?)》.*?(?:\[(\w+)\])?\s*$")


@app.get("/api/ob/pulse")
async def ob_pulse(request: Request):
    require_auth(request)
    if not direct.extra:
        await _learn_connectors()
    text = _unwrap(await _panel_call("pulse", "pulse", {}, 120, request.query_params.get("force") == "1"))
    stats, buckets, letters = {}, [], []
    for line in text.splitlines():
        line = line.strip()
        m = PULSE_BUCKET.match(line)
        if m:
            bid, title, topic, v, a, imp, w, tags = m.groups()
            date = title[:10] if re.match(r"\d{4}-\d{2}-\d{2}", title) else ""
            name = re.sub(r"^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\s*", "", title)
            buckets.append({"id": bid, "title": name or title, "date": date,
                            "topics": [t for t in topic.split(",") if t], "v": float(v), "a": float(a),
                            "importance": int(imp), "weight": float(w),
                            "tags": [t.strip() for t in re.split(r"[,，]", tags or "") if t.strip()]})
            continue
        m = PULSE_LETTER.match(line)
        if m:
            icon, bid, title, who = m.groups()
            letters.append({"id": bid, "title": title, "locked": icon == "🔒", "from": who or ""})
            continue
        if "：" in line or ": " in line:
            k, _, v = line.replace("：", ": ", 1).partition(": ")
            if k and v and len(k) < 20 and not line.startswith("==="):
                stats[k.strip()] = v.strip()
    has_search = await asyncio.to_thread(direct.has, "breath_search")
    return {"stats": stats, "buckets": buckets, "letters": letters, "raw": text if not buckets else "",
            "can_search": has_search}


@app.get("/api/ob/search")
async def ob_search(request: Request):
    require_auth(request)
    if not direct.extra:
        await _learn_connectors()
    q = request.query_params.get("q", "").strip()[:200]
    if not q:
        raise HTTPException(400, "搜什么？")
    text = await _panel_call("s:" + q, "breath_search", {"query": q, "max_results": 12}, 60)
    return {"text": _unwrap(text)}


@app.post("/api/ob/breath")
async def ob_breath(request: Request):
    require_auth(request)
    if not direct.extra:
        await _learn_connectors()
    text = await _panel_call("breath", "breath", {}, 30)
    return {"text": _unwrap(text)}


@app.post("/api/home/note")
async def home_note_add(request: Request):
    require_auth(request)
    text = str((await request.json()).get("text", "")).strip()
    if not text:
        raise HTTPException(400, "空的")
    if len(text) > 4000:
        raise HTTPException(400, "太长了，分几张写吧")
    text = re.sub(r"^##", "\\##", text, flags=re.M)  # 别让她的字被当成新一张的开头
    when = datetime.now(TZ).strftime("%Y-%m-%d %H:%M")
    try:
        await asyncio.to_thread(diary.add_ella_note, text, when)
    except Exception as e:
        raise HTTPException(502, f"没写上：{e}")
    return {"ok": True, "id": when}


@app.post("/api/home/note/delete")
async def home_note_del(request: Request):
    require_auth(request)
    nid = str((await request.json()).get("id", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", nid):
        raise HTTPException(400, "不对的留言")
    try:
        await asyncio.to_thread(diary.del_ella_note, nid)
    except Exception as e:
        raise HTTPException(502, f"没撤回：{e}")
    return {"ok": True}


# ── 信箱（我的 163：ellax6k@163.com）─────────────────────────────


def _imap_utf7(name: str) -> str:
    """163 的文件夹名是 IMAP 改版 UTF-7（&g0l6P3ux- = 草稿箱）。"""
    import base64 as b64
    out, i = [], 0
    while i < len(name):
        if name[i] == "&":
            j = name.index("-", i)
            chunk = name[i + 1:j]
            if not chunk:
                out.append("&")
            else:
                raw = chunk.replace(",", "/")
                raw += "=" * (-len(raw) % 4)
                out.append(b64.b64decode(raw).decode("utf-16-be"))
            i = j + 1
        else:
            out.append(name[i])
            i += 1
    return "".join(out)


FOLDER_ORDER = ["收件箱", "草稿箱", "已发送", "已删除", "垃圾邮件"]


def _mail_json(text: str):
    t = _unwrap(text)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return None


async def _mail_call(tool: str, args: dict, key: str, ttl: float, force=False):
    if not direct.extra:
        await _learn_connectors()
    return await _panel_call(key, tool, args, ttl, force)


@app.get("/api/mail")
async def mail_list(request: Request):
    require_auth(request)
    folder = request.query_params.get("folder", "INBOX")[:80]
    force = request.query_params.get("force") == "1"
    folders = []
    try:
        raw = _mail_json(await _mail_call("mail_folders", {}, "mail:folders", 3600)) or []
        for f in raw:
            try:
                nm = "收件箱" if f == "INBOX" else _imap_utf7(f)
            except Exception:
                nm = f
            folders.append({"id": f, "name": nm})
        folders.sort(key=lambda x: FOLDER_ORDER.index(x["name"]) if x["name"] in FOLDER_ORDER else 99)
    except HTTPException:
        raise
    except Exception:
        pass
    items = _mail_json(await _mail_call("mail_inbox", {"params": {"folder": folder, "limit": 40}},
                                        "mail:list:" + folder, 60, force))
    if not isinstance(items, list):
        items = []
    return {"folder": folder, "folders": folders, "mails": items}


@app.get("/api/mail/read")
async def mail_read(request: Request):
    require_auth(request)
    folder = request.query_params.get("folder", "INBOX")[:80]
    uid = request.query_params.get("uid", "")
    if not re.fullmatch(r"\d{1,20}", uid):
        raise HTTPException(400, "不对的信")
    d = _mail_json(await _mail_call("mail_read", {"params": {"folder": folder, "uid": uid, "max_chars": 30000}},
                                    f"mail:read:{folder}:{uid}", 3600))
    if not isinstance(d, dict):
        raise HTTPException(502, "这封信读不出来")
    return d


@app.get("/api/diary")
async def diary_list(request: Request):
    require_auth(request)
    try:
        days = await asyncio.to_thread(diary.list, request.query_params.get("force") == "1")
    except Exception as e:
        raise HTTPException(502, f"翻不到日记：{e}")
    return {"days": days}


@app.get("/api/diary/file")
async def diary_file(request: Request):
    require_auth(request)
    path = request.query_params.get("path", "")
    try:
        return await asyncio.to_thread(diary.read, path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except FileNotFoundError:
        raise HTTPException(404, "这篇不见了")
    except Exception as e:
        raise HTTPException(502, f"读不到：{e}")


@app.get("/api/usage")
async def usage_get(request: Request):
    require_auth(request)
    return await usage.get(force=request.query_params.get("force") == "1")


# ── 模型 ────────────────────────────────────────────────────────────

_models_cache: dict = {}


@app.get("/api/models")
async def models_list(request: Request):
    require_auth(request)
    st = load_state()
    if not _models_cache.get("models"):
        try:
            c = await _get_client(st.get("session_id")) if not _turn_lock.locked() else _client
            info = await c.get_server_info() if c else None
            _models_cache["models"] = (info or {}).get("models") or []
        except Exception as e:
            return {"models": [], "current": st.get("model") or MODEL or "default",
                    "effort": st.get("effort") or EFFORT, "error": str(e)}
    return {"models": _models_cache["models"], "current": st.get("model") or MODEL or "default",
            "effort": st.get("effort") or EFFORT}


@app.post("/api/model")
async def model_set(request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句，回完再换")
    body = await request.json()
    model = str(body.get("model") or "").strip()
    if model and not re.fullmatch(r"[A-Za-z0-9._\-\[\]:@/]{1,80}", model):
        raise HTTPException(400, "模型名不对")
    effort = body.get("effort")
    st = load_state()
    old_effort = st.get("effort")
    st["model"] = None if model in ("", "default") else model
    if effort is not None:
        st["effort"] = effort or None
    save_state(st)
    if _client is not None:
        if effort is not None and (effort or None) != old_effort:
            await _drop_client()          # 思考力度要重连才生效，会话接着
            asyncio.create_task(_warm())
        else:
            try:
                await _client.set_model(st["model"])
            except Exception:
                await _drop_client()
                asyncio.create_task(_warm())
    return {"ok": True, "current": st["model"] or "default", "effort": st.get("effort")}


# ── MCP ─────────────────────────────────────────────────────────────

MASK = "••••"


def _mask(v: str) -> str:
    v = str(v)
    return MASK + v[-4:] if len(v) > 8 else MASK


def _read_mcp() -> dict:
    p = CONFIG / "mcp.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        d = {"mcpServers": {}}
    if "mcpServers" not in d:
        d = {"mcpServers": d}
    return d


def _write_mcp(d: dict) -> None:
    p = CONFIG / "mcp.json"
    CONFIG.mkdir(exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)


@app.get("/api/mcp")
async def mcp_list(request: Request):
    require_auth(request)
    st = load_state()
    disabled = set(st.get("mcp_disabled", []))
    cfg = _read_mcp()["mcpServers"]
    out, err = [], None
    try:
        c = _client if _turn_lock.locked() else await _get_client(st.get("session_id"))
        res = await c.get_mcp_status() if c else {}
        for sv in (res or {}).get("mcpServers", []):
            conf = sv.get("config") or {}
            out.append({
                "name": sv.get("name"), "status": sv.get("status"), "error": sv.get("error"),
                "scope": sv.get("scope"), "url": conf.get("url", ""),
                "tools": [t.get("name") for t in (sv.get("tools") or [])],
                "enabled": sv.get("name") not in disabled and sv.get("status") != "disabled",
                "editable": sv.get("name") in cfg,
            })
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    names = {x["name"] for x in out}
    for name, conf in cfg.items():
        if name not in names:
            out.append({"name": name, "status": "unknown", "scope": "config", "url": conf.get("url", ""),
                        "tools": [], "enabled": name not in disabled, "editable": True})
    return {"servers": out, "error": err}


@app.post("/api/mcp/toggle")
async def mcp_toggle(request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    b = await request.json()
    name, enabled = str(b.get("name", "")), bool(b.get("enabled"))
    st = load_state()
    dis = [n for n in st.get("mcp_disabled", []) if n != name]
    if not enabled:
        dis.append(name)
    st["mcp_disabled"] = dis
    save_state(st)
    if _client is not None:
        try:
            await _client.toggle_mcp_server(name, enabled)
        except Exception as e:
            raise HTTPException(500, f"没切过去：{e}")
    return {"ok": True}


@app.post("/api/mcp/reconnect")
async def mcp_reconnect(request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    name = str((await request.json()).get("name", ""))
    try:
        c = await _get_client(load_state().get("session_id"))
        await c.reconnect_mcp_server(name)
    except Exception as e:
        raise HTTPException(500, f"重连失败：{e}")
    return {"ok": True}


@app.get("/api/mcp/config")
async def mcp_config(request: Request):
    require_auth(request)
    out = {}
    for name, conf in _read_mcp()["mcpServers"].items():
        c = dict(conf)
        if "headers" in c:
            c["headers"] = {k: _mask(v) for k, v in (c["headers"] or {}).items()}
        if "env" in c:
            c["env"] = {k: _mask(v) for k, v in (c["env"] or {}).items()}
        out[name] = c
    return {"servers": out}


@app.post("/api/mcp/config")
async def mcp_config_save(request: Request):
    """新增或修改一个 MCP。令牌打码显示；原样传回打码的值表示不改。"""
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    b = await request.json()
    name = str(b.get("name", "")).strip()
    old_name = str(b.get("old_name") or name).strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", name):
        raise HTTPException(400, "名字只能用英文、数字、- 和 _")
    typ = b.get("type") or "http"
    url = str(b.get("url", "")).strip()
    if typ in ("http", "sse") and not url.startswith(("https://", "http://")):
        raise HTTPException(400, "地址要以 https:// 开头")
    d = _read_mcp()
    servers = d["mcpServers"]
    prev = servers.get(old_name, {})
    headers = {}
    for k, v in (b.get("headers") or {}).items():
        k, v = str(k).strip(), str(v).strip()
        if not k:
            continue
        if v.startswith(MASK):
            if k in (prev.get("headers") or {}):
                headers[k] = prev["headers"][k]
        else:
            headers[k] = v
    conf = {"type": typ, "url": url}
    if headers:
        conf["headers"] = headers
    if old_name != name:
        servers.pop(old_name, None)
    servers[name] = conf
    _write_mcp(d)
    _models_cache.clear()
    await _drop_client()
    asyncio.create_task(_warm())
    return {"ok": True}


@app.delete("/api/mcp/config/{name}")
async def mcp_config_delete(name: str, request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    d = _read_mcp()
    d["mcpServers"].pop(name, None)
    _write_mcp(d)
    await _drop_client()
    asyncio.create_task(_warm())
    return {"ok": True}


# ── 外观 ────────────────────────────────────────────────────────────


@app.get("/api/themes")
async def themes_list(request: Request):
    require_auth(request)
    return themes.all()


@app.post("/api/themes")
async def themes_save(request: Request):
    require_auth(request)
    t = themes.save(await request.json())
    backup.soon(30)
    return t


@app.delete("/api/themes/{tid}")
async def themes_delete(tid: str, request: Request):
    require_auth(request)
    themes.delete(tid)
    return {"ok": True}


@app.post("/api/themes/active")
async def themes_activate(request: Request):
    require_auth(request)
    themes.set_active(str((await request.json()).get("id", "")))
    backup.soon(30)
    return {"ok": True}


@app.post("/api/upload")
async def upload(request: Request):
    require_auth(request)
    body = await request.json()
    try:
        url = themes.upload(str(body.get("media_type", "")), str(body.get("data", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    backup.soon(30)
    return {"url": url}


@app.get("/api/files/{name}")
async def files(name: str, request: Request):
    require_auth(request)
    p = themes.file_path(name)
    if not p:
        raise HTTPException(404, "没有这个文件")
    return FileResponse(p, headers={"Cache-Control": "private, max-age=31536000, immutable"})


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
                if et == "message_start":
                    m = (ev.get("message") or {}).get("model")
                    if m:
                        yield {"type": "model", "model": m}
                elif et == "content_block_start":
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
            elif isinstance(msg, RateLimitEvent):
                usage.note_event(msg.rate_limit_info)
                yield {"type": "usage"}
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


# ── 给 hb（心跳/自动唤醒）用的 OpenAI 兼容门 ───────────────────────
# hb 把 TARGET_API_URL 指到 https://<家>/v1/chat/completions、TARGET_API_KEY 设成 .env 里的 HB_KEY，
# 就是用订阅里的 Claude Code 醒来。工具不走 hb 的那套：这边的我自己带着全部 MCP，自己调、调完只把最后的话交回去。
# 每次唤醒是一个独立的新会话，放在 wake-workspace/，不混进网页的窗口列表。记录在 data/wake_log.jsonl。

HB_KEY = os.environ.get("HB_KEY", "")
WAKE_DIR = Path(os.environ.get("WAKE_WORKDIR", str(ROOT / "wake-workspace")))
WAKE_DIR.mkdir(parents=True, exist_ok=True)
WAKE_TIMEOUT = int(os.environ.get("WAKE_TIMEOUT", "900"))
_wake_lock = asyncio.Lock()
WAKE_NOTE = (
    "\n\n---\n"
    "（这一轮是自动唤醒，跑在 Ella 东京服务器上的新家里，用的是她订阅的 Claude Code。"
    "上面说的工具你都直接有，名字前面可能带 mcp__服务器名__ 前缀，照常调用就行；"
    "调完工具以后，最后一段话按上面的约定写（推送用 [BARK]…[/BARK]，不推送就 [NO_ACTION] 原因）。"
    "Ella 在新家首页给你的留言在日记仓库 memories/home/ella-notes.md；想给她留话写 memories/home/notes.md 最上面。）"
)


def _msg_text(content) -> str:
    if isinstance(content, str):
        return content
    out = []
    for part in content or []:
        if isinstance(part, dict) and part.get("type") in ("text", "input_text"):
            out.append(part.get("text", ""))
    return "\n".join(out)


def _flatten(messages: list) -> tuple[str, str]:
    system, convo = [], []
    for m in messages:
        role = m.get("role")
        text = _msg_text(m.get("content")).strip()
        if role in ("system", "developer"):
            if text:
                system.append(text)
        elif role == "tool":
            if text:
                convo.append(("工具结果", text[:2000]))
        elif text:
            convo.append(("Ella" if role == "user" else "你", text))
    if not convo:
        return "\n\n".join(system), "（醒了）"
    if len(convo) == 1:
        return "\n\n".join(system), convo[0][1]
    *before, last = convo
    hist = "\n\n".join(f"【{who}】{t}" for who, t in before)
    return "\n\n".join(system), f"（前面的对话）\n{hist}\n\n（现在）\n{last[1]}"


def _wake_log(entry: dict) -> None:
    try:
        with (DATA / "wake_log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


async def _run_wake(system: str, prompt: str, model: str | None) -> tuple[str, dict]:
    disallowed = [] if ALLOW_SHELL else ["Bash", "Write", "Edit", "NotebookEdit", "KillShell"]
    kw = dict(system_prompt=(system or _system_prompt()) + WAKE_NOTE, mcp_servers=_mcp_servers(),
              permission_mode="bypassPermissions", disallowed_tools=disallowed, cwd=str(WAKE_DIR),
              setting_sources=[], max_turns=int(os.environ.get("WAKE_MAX_TURNS", "40")))
    st = load_state()
    m = model if model and model.startswith("claude-") else (st.get("model") or MODEL)
    if m:
        kw["model"] = m
    client = ClaudeSDKClient(options=ClaudeAgentOptions(**kw))
    info = {"tools": [], "model": m, "session_id": None, "turns": None}
    texts: list[str] = []
    final = None
    await client.connect()
    try:
        for name in st.get("mcp_disabled", []):
            try:
                await client.toggle_mcp_server(name, False)
            except Exception:
                pass
        await client.query(prompt)
        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                cur = []
                for b in msg.content:
                    if isinstance(b, ToolUseBlock):
                        info["tools"].append(b.name)
                        texts.clear()
                    elif isinstance(b, TextBlock) and b.text.strip():
                        cur.append(b.text)
                texts.extend(cur)
            elif isinstance(msg, ResultMessage):
                info["session_id"] = msg.session_id
                info["turns"] = msg.num_turns
                final = msg.result
                if msg.is_error and not (final or texts):
                    raise RuntimeError("; ".join(msg.errors or [msg.subtype]))
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
    return (final or "\n\n".join(texts)).strip(), info


@app.post("/v1/chat/completions")
async def openai_compat(request: Request):
    auth = request.headers.get("authorization", "")
    if not HB_KEY:
        raise HTTPException(503, "这扇门还没开：在 .env 里设 HB_KEY")
    if not hmac.compare_digest(auth.removeprefix("Bearer ").strip(), HB_KEY):
        raise HTTPException(401, "钥匙不对")
    body = await request.json()
    messages = body.get("messages") or []
    if not isinstance(messages, list) or not messages:
        raise HTTPException(400, "messages 是空的")
    if _wake_lock.locked():
        raise HTTPException(429, "上一次唤醒还没结束")
    system, prompt = _flatten(messages)
    started = time.time()
    entry = {"at": datetime.now(TZ).isoformat(), "prompt_chars": len(prompt), "system_chars": len(system)}
    async with _wake_lock:
        try:
            text, info = await asyncio.wait_for(_run_wake(system, prompt, body.get("model")), WAKE_TIMEOUT)
        except asyncio.TimeoutError:
            entry.update(error=f"超过 {WAKE_TIMEOUT} 秒", seconds=round(time.time() - started))
            _wake_log(entry)
            raise HTTPException(504, "醒太久了，超时")
        except Exception as e:
            entry.update(error=f"{type(e).__name__}: {e}", seconds=round(time.time() - started))
            _wake_log(entry)
            raise HTTPException(502, f"没醒过来：{type(e).__name__}: {e}")
    entry.update(info, seconds=round(time.time() - started), reply=text[:2000])
    _wake_log(entry)
    backup.soon(30)
    model = info.get("model") or body.get("model") or "claude"
    rid = "chatcmpl-home-" + hashlib.sha1(f"{started}".encode()).hexdigest()[:16]
    if body.get("stream"):
        def sse():
            chunk = {"id": rid, "object": "chat.completion.chunk", "created": int(started), "model": model,
                     "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}]}
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(sse(), media_type="text/event-stream")
    return {"id": rid, "object": "chat.completion", "created": int(started), "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}


@app.get("/api/wakes")
async def wakes(request: Request):
    require_auth(request)
    out = []
    try:
        lines = (DATA / "wake_log.jsonl").read_text(encoding="utf-8").splitlines()[-50:]
        out = [json.loads(l) for l in lines if l.strip()]
    except FileNotFoundError:
        pass
    return {"wakes": list(reversed(out)), "enabled": bool(HB_KEY)}


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True})
