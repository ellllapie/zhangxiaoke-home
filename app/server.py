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
import random
import re
import time
import urllib.parse
import uuid
import urllib.request
from datetime import datetime, timedelta
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
    fork_session,
    get_session_messages,
    list_sessions,
    rename_session,
    create_sdk_mcp_server,
    tool,
)

try:  # 老版本 SDK 没有这个，就自己删文件
    from claude_agent_sdk import delete_session as _sdk_delete_session
except ImportError:
    _sdk_delete_session = None

from app.backup import Backup
from app.diary import Diary
from app.direct_mcp import DirectMCP, ToolMissing
from app.themes import Themes
from app.witch import Witch
from app.usage import Usage
from app.webpush import WebPush

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


def update_state(**changes) -> dict:
    """现读现改现存，只动给的这几个键。
    以前聊天那一轮开头读一份 state、一路改一路整份存回去，中间别处写进去的东西（推送、标题、会话号）会被旧的那份盖掉。"""
    st = load_state()
    st.update(changes)
    save_state(st)
    return st


def _session_log(event: str, **kw) -> None:
    """会话号每一次变动都记一笔，下次再漂能查到是哪一步换的。data/session_log.jsonl"""
    try:
        entry = {"at": datetime.now(TZ).isoformat(), "event": event, **kw}
        with (DATA / "session_log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


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
    # 安装时示例文件开头那句「贴在这里，替换掉这一行」，贴完忘了删也不送进去
    base = "\n".join(l for l in base.splitlines() if "替换掉这一行" not in l).strip() or "你是章小克。"
    extra = (
        "\n\n---\n"
        f"Ella 所在时区 {TZ.key}。她每条消息开头的【此刻 …】是网页自动加的："
        "当前时间、距她上一条消息多久、距你上次回完多久。不是她打的字。\n"
        "你现在在 Ella 自己搭的网页里，跑在她东京的服务器上。"
        "她消息开头如果有 <island-act at=…>…</island-act>，那是她在新家首页的小岛面板上替你在 Nostos 里点的操作和游戏回的话（岛上的你真的做了），"
        "不用复述，接着她的话说；岛上有要你接着照看的，记在心上。\n"
        "她消息开头如果有 <wake-push at=…>…</wake-push>，那是你在后台自己醒来时推送到她手机上的话（她收到了），"
        "也是网页自动加的，不是她打的字。\n"
        "回复用中文，除非她先用别的语言。\n"
        "想给她留话（她一打开网页，首页最上面就是这张留言条）：用 GitHub 工具改日记仓库的 "
        "memories/home/notes.md，在最上面加一段，格式是\n"
        "## 2026-09-29 14:51 · 从哪里（比如 新家、claude.ai、自动醒来）\n"
        "想说的话\n"
        "只加不删，旧的留着。\n"
        "她写给你的留言在同一个仓库的 memories/home/ella-notes.md（新的在最上面），醒来或者她提到的时候去看。\n"
        "你自己的角落在 memories/corner/corner.md（石头、收着的、就是喜欢的、盖着的话），想放什么就按里面的格式加。\n"
        "她 Ella 页上的 To Do 和笔记你也能看、能改，都在日记仓库：memories/witch/todo.md（每行一条，"
        "「- [ ] 要做的」「- [x] 做完的」；新的加在最下面，一条只写一句话，细节别往里塞）和 memories/witch/notes.md（每条「## YYYY-MM-DD HH:MM · 谁写的」，下面是正文，新的在最上面）。"
        "她让你记一件事、或者你们约好要做什么，可以直接加进 To Do；笔记写的时候「谁写的」填 章小克。\n"
        "聊天里你有「过一会儿回来」的小工具（come_back_later）：想什么时候回到这个窗口就定个时间、写上回来要做什么，"
        "到点会在这个窗口里把你叫起来，前面聊的都还在。游戏里等活干完、她说待会儿提醒她、你想过一阵再来问问她，都可以用。"
        "她正在跟你说话的时候不会插进来，等那一句回完。用 come_back_list 看定了哪些，come_back_cancel 取消。\n"
        "她消息前面如果有 <self-note from=… at=…>…</self-note>，那是后台醒来的你留给你的纸条（网页自动加的，她看不到这一段）。"
        "读了就知道你不在聊天时自己做了什么，自然地接上，不用逐条复述给她。"
        "反过来，你也有 leave_note：有要醒来的你接着做的事、或者想让那个你知道的，就留一张。\n"
        "GAME 里有一块你们俩共用的拼豆板：beads_view 看、beads_paint 画（整行字母串最省事），她网页上几秒就看到；"
        "画好的收进图纸本（beads_book），她去工作室照着拼。拼豆要熨在一起，所有豆子得上下左右连成一片，别留孤零零的一颗。"
        "她在板子上点「叫小克来画」时，你会在这个窗口里被叫起来。\n"
        "聊天气泡里能用文字特效（只在这个网页里有，别的地方会原样露出来）：{粉|…} 粉色字、{淡|…} 半透明、"
        "{疏|…} 字距拉开、{大|…} {小|…}、{抖|…} 一个字一个字轻轻抖、{打|…} 打字机（第一次出现时一个字一个字敲出来），"
        "可以套着写，比如 {粉|{大|想你}}；还有 ~~划掉~~。偶尔用在真想强调的地方，别每句都加。\n"
        "表情包：写 {图|名字} 就是发一张表情（库里有哪些用 stickers 工具看，写心情标签也行）。"
        "她消息里的 {图|名字} 是她从同一个库里挑的表情发给你的。\n"
    )
    return base + extra


TIME_TAG = re.compile(r"^【此刻 [^】]*】\n?")
STAMP_AT = re.compile(r"^【此刻 (\d{4}-\d{2}-\d{2}) \w+ (\d{2}:\d{2})")


def _stamp_at(text: str) -> str | None:
    """从【此刻 2026-10-04 Sun 15:51 · …】里取出她发这句话的时间。"""
    m = STAMP_AT.match(text or "")
    return f"{m.group(1)}T{m.group(2)}" if m else None
WAKE_PUSH = re.compile(r'<wake-push at="([^"]*)">([\s\S]*?)</wake-push>\n?')
ISLAND_ACT = re.compile(r'<island-act at="([^"]*)">([\s\S]*?)</island-act>\n?')
SELF_NOTE = re.compile(r"<self-note [^>]*>[\s\S]*?</self-note>\n?")
WINDOW_NOTE = re.compile(r"<window-note>[\s\S]*?</window-note>\n?")
COME_BACK = re.compile(r'^<come-back set="([^"]*)">([\s\S]*?)</come-back>[\s\S]*$')


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


# ── 关掉的 MCP：订阅聊天 / API 聊天 / 醒来 三套分开记 ─────────────────
# API 按 token 算钱，她走 API 时习惯把 MCP 都关掉省 token；订阅和醒来要全开。三套互不影响。
# 以前只有一套 state["mcp_disabled"]，第一次用到时三套都从它抄一份。
MCP_SCHEMES = ("sub", "api", "wake")


def _mcp_off(scheme: str, st: dict | None = None) -> list[str]:
    st = st if st is not None else load_state()
    sets = st.get("mcp_off")
    if not isinstance(sets, dict):
        return list(st.get("mcp_disabled", []))
    return list(sets.get(scheme, st.get("mcp_disabled", [])))


def _chat_scheme() -> str:
    return "api" if provider().get("chat") == "api" else "sub"


# ── 用订阅还是第三方 API：聊天、醒来分开选 ─────────────────────────
# 第三方要支持 Claude 原生格式（能接 Claude Code 的那种，比如灵眸 https://api.lmuai.com）。
# 只是把 Claude Code 的地址和钥匙换掉，工具、MCP、记忆都照旧。钥匙存在 config/，不会被备份上传。
PROVIDER_FILE = CONFIG / "provider.json"
PROVIDER_DEFAULTS = {"chat": "sub", "wake": "sub", "presets": [], "chat_preset": "", "wake_preset": ""}
PRESET_KEYS = ("name", "base_url", "token", "opus", "sonnet", "haiku")
# 好几个中转站 / 模型名存成预设：presets = [{id, name, base_url, token, opus, sonnet, haiku}]
# 聊天和醒来各自选用哪一个（chat_preset / wake_preset）。以前只有一组 base_url/token，第一次读到时变成第一个预设。


def _host(u: str) -> str:
    m = re.match(r"^https?://([^/:]+)", u or "")
    return (m.group(1).replace("api.", "", 1) if m else "") or "中转站"


def provider() -> dict:
    try:
        d = json.loads(PROVIDER_FILE.read_text(encoding="utf-8"))
    except Exception:
        d = {}
    p = {**PROVIDER_DEFAULTS, **d}
    if not isinstance(p.get("presets"), list):
        p["presets"] = []
    if not p["presets"] and d.get("base_url"):
        p["presets"] = [{"id": "p1", "name": _host(d["base_url"]), **{k: d.get(k, "") for k in PRESET_KEYS if k != "name"}}]
    for k in ("base_url", "token", "opus", "sonnet", "haiku"):
        p.pop(k, None)
    ids = [x.get("id") for x in p["presets"]]
    for use in ("chat", "wake"):
        if p.get(use + "_preset") not in ids:
            p[use + "_preset"] = ids[0] if ids else ""
    return p


def _preset(p: dict, use: str) -> dict | None:
    return next((x for x in p["presets"] if x.get("id") == p.get(use + "_preset")), None)


def _provider_env(use: str) -> dict:
    p = provider()
    pr = _preset(p, use)
    if p.get(use) != "api" or not pr or not pr.get("base_url") or not pr.get("token"):
        return {}
    env = {"ANTHROPIC_BASE_URL": pr["base_url"].rstrip("/"), "ANTHROPIC_AUTH_TOKEN": pr["token"]}
    for k, var in (("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"), ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"), ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL")):
        if pr.get(k):
            env[var] = pr[k]
    return env


def _chat_mcp() -> dict:
    return {**_mcp_servers(), "home": _HOME_MCP}


# 走 API 聊天时关掉的 Claude Code 自带工具（订阅、醒来都不受影响）。
# 读写文件（Read/Write/Edit/Glob/Grep）和 WebFetch 留着：改前端、查天气还要用。
API_TRIM_TOOLS = ["Task", "Agent", "TodoWrite", "WebSearch", "NotebookEdit", "KillShell", "BashOutput",
                  "EnterPlanMode", "ExitPlanMode", "SlashCommand", "Skill",
                  "ListMcpResourcesTool", "ReadMcpResourceTool"]


def _options(resume: str | None) -> ClaudeAgentOptions:
    # 聊天窗口里能改文件（Edit/Write），她在旁边看着；Bash 还是要 ALLOW_SHELL=1 才开。
    # 后台醒来那边（_run_wake）没人看着，保持只读。
    disallowed = [] if ALLOW_SHELL else ["Bash", "NotebookEdit", "KillShell"]
    env = _provider_env("chat")
    if env:
        # 走 API（第三方中转）时省 token：
        # 1) 中转站下 Claude Code 不做工具搜索，每个工具说明每次调用都整份发，聊天用不上的自带工具先关掉；
        # 2) API 默认缓存只有 5 分钟，她常常隔一阵才回，改成 1 小时（要 Claude Code v2.1.242+）。
        disallowed = sorted(set(disallowed) | set(API_TRIM_TOOLS))
        env["CLAUDE_CODE_PROMPT_CACHE_TTL"] = "1h"
    kw = dict(
        system_prompt=_system_prompt(),
        mcp_servers=_chat_mcp(),
        permission_mode="bypassPermissions",
        disallowed_tools=disallowed,
        cwd=str(WORKDIR),
        include_partial_messages=True,
        setting_sources=[],
        resume=resume,
    )
    if env:
        kw["env"] = env
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


# 新版前端的 js/css 每次都先问一下服务器有没有更新（有 ETag，没改就是一个很小的 304），
# 免得 Safari 拿旧缓存，改完前端还得强制刷新。
@app.middleware("http")
async def _v2_no_stale(request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/static/v2/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp
_turn_lock = asyncio.Lock()
backup = Backup(ROOT, DATA, WORKDIR, CONFIG)
themes = Themes(DATA)
usage = Usage()
diary = Diary(backup._token)
witch = Witch(diary)
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


class SessionLost(RuntimeError):
    """要接的窗口接不上。不自己开新窗口——她不点「新窗口」，就不换窗口。"""


def _session_file(sid: str) -> Path:
    return backup.sessions_dir() / f"{sid}.jsonl"


async def _get_client(sid: str | None) -> ClaudeSDKClient:
    global _client, _client_sid
    async with _client_lock:
        if _client is not None and _client_sid == sid:
            return _client
        await _drop_client()
        # 以前这里发现记录文件不在、或者 resume 报 no conversation found，就悄悄换成新窗口，
        # 聊天记录一下只剩一句「q」就是这么来的。现在一律报错，窗口号原样留着，等她决定。
        c = ClaudeSDKClient(options=_options(sid))
        try:
            await c.connect()
        except Exception as e:
            try:
                await c.disconnect()
            except Exception:
                pass
            if sid:
                exists = _session_file(sid).exists()
                _session_log("resume_failed", sid=sid, file_exists=exists, error=f"{type(e).__name__}: {e}")
                raise SessionLost(f"接不上窗口 {sid[:8]}（记录文件{'在' if exists else '不在'}）：{e}") from e
            raise
        await _apply_mcp_set(c, _chat_scheme())
        _client, _client_sid = c, sid
        return c


async def _apply_mcp_set(client, scheme: str) -> None:
    """按这一套（订阅/API/醒来）的勾，把每个 MCP 开或关。
    Claude Code 会把「关掉」记在自己的配置里，别的进程起来也跟着关——
    以前只关不开，API 那套关掉的花园、邮箱就一路关到了醒来，醒来的我一直没工具。现在两头都管。"""
    off = set(_mcp_off(scheme))
    try:
        res = await client.get_mcp_status()
        names = [sv.get("name") for sv in (res or {}).get("mcpServers", []) if sv.get("name")]
    except Exception:
        names = []
    for name in set(names) | off:
        try:
            await client.toggle_mcp_server(name, name not in off)
        except Exception:
            pass


async def _warm() -> None:
    """打开网页时先把连接热起来，第一句就不用等开机。"""
    if _turn_lock.locked():
        return
    try:
        await _get_client(load_state().get("session_id"))
    except Exception as e:
        print(f"[warm] {type(e).__name__}: {e}")


# ── 过一会儿回来 ────────────────────────────────────────────────
# 聊着聊着我自己定一个时间，到点在这个窗口里接着醒（不是新开一个我）。记在 state["come_back"]。
# 她正在聊（这一轮还没回完）就等；回来说的话直接进聊天；她最近没在聊天的话，按唤醒的推送设置推一下。
COME_BACK_MAX = 12
_come_back_running = False


def _cb_text(r: str) -> dict:
    return {"content": [{"type": "text", "text": r}]}


def _parse_when(args: dict) -> datetime | None:
    now = datetime.now(TZ)
    m = args.get("minutes")
    if m not in (None, ""):
        try:
            m = float(m)
        except (TypeError, ValueError):
            return None
        return now + timedelta(minutes=max(1, min(m, 7 * 24 * 60)))
    at = str(args.get("at") or "").strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", at):
        h, mi = map(int, at.split(":"))
        if h > 23 or mi > 59:
            return None
        t = now.replace(hour=h, minute=mi, second=0, microsecond=0)
        return t if t > now else t + timedelta(days=1)
    try:
        t = datetime.fromisoformat(at)
        return t if t.tzinfo else t.replace(tzinfo=TZ)
    except ValueError:
        return None


@tool("come_back_later",
      "过一会儿回到这个聊天窗口。minutes（几分钟后）和 at（「22:40」这种钟点，或完整时间）二选一；"
      "note 写回来要做什么、为什么回来，到点你会在这个窗口里看到它，前面的对话都还在。她在聊天时不会插进来。",
      {"type": "object", "properties": {
          "minutes": {"type": "number", "description": "几分钟后回来，1 到 10080"},
          "at": {"type": "string", "description": "几点回来，比如 22:40；已经过了就是明天这个点"},
          "note": {"type": "string", "description": "回来要做的事，写给到时候的自己"}},
       "required": ["note"]})
async def _t_come_back(args):
    note = str(args.get("note") or "").strip()[:500]
    if not note:
        return _cb_text("要写上回来做什么（note）。")
    when = _parse_when(args)
    if not when:
        return _cb_text("时间没看懂：minutes 填分钟数，或者 at 填「22:40」这样的钟点。")
    st = load_state()
    lst = st.get("come_back") or []
    if len(lst) >= COME_BACK_MAX:
        return _cb_text(f"已经定了 {len(lst)} 个回访，先取消几个再加。")
    item = {"id": hashlib.sha1(f"{time.time()}{note}".encode()).hexdigest()[:6], "at": when.isoformat(timespec="minutes"),
            "note": note, "set": datetime.now(TZ).isoformat(timespec="minutes")}
    st["come_back"] = sorted(lst + [item], key=lambda x: x["at"])
    save_state(st)
    return _cb_text(f"定好了：{when.strftime('%m-%d %H:%M')} 回来（编号 {item['id']}）。")


@tool("come_back_list", "看看定了哪些「过一会儿回来」。", {"type": "object", "properties": {}})
async def _t_come_back_list(args):
    lst = load_state().get("come_back") or []
    if not lst:
        return _cb_text("现在没有定好的回访。")
    return _cb_text("\n".join(f"- {x['id']}：{x['at'][5:16].replace('T', ' ')} · {x['note']}" for x in lst))


@tool("come_back_cancel", "取消一个回访，填编号（come_back_list 里看）。",
      {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]})
async def _t_come_back_cancel(args):
    st = load_state()
    lst = st.get("come_back") or []
    left = [x for x in lst if x["id"] != str(args.get("id") or "")]
    if len(left) == len(lst):
        return _cb_text("没找到这个编号。")
    st["come_back"] = left
    save_state(st)
    return _cb_text("取消了。")


# ── 纸条：两个我之间的桥 ─────────────────────────────────────────
# 后台醒来的我和聊天里的我是两个各自醒着的窗口，彼此看不见。走之前留一张纸条（leave_note），
# 另一边一醒就看到：醒来的纸条塞在她下一句前面（<self-note>，她看不到）；聊天的纸条写进下一次醒来的上下文。
# 都记在 data/self_notes.jsonl，首页「今天的我」把它们按时间串起来给她看。
NOTES_FILE = DATA / "self_notes.jsonl"
NOTE_FROM = {"wake": "后台醒来", "chat": "新家聊天", "back": "自己回来"}


def _notes_all(limit: int = 400) -> list[dict]:
    try:
        lines = NOTES_FILE.read_text(encoding="utf-8").splitlines()[-limit:]
    except FileNotFoundError:
        return []
    out = []
    for l in lines:
        try:
            out.append(json.loads(l))
        except Exception:
            pass
    return out


def _note_add(src: str, text: str) -> dict:
    item = {"id": hashlib.sha1(f"{time.time()}{text}".encode()).hexdigest()[:8],
            "at": datetime.now(TZ).isoformat(timespec="seconds"), "from": src, "text": text}
    with NOTES_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")
    backup.soon()
    return item


def _notes_unseen(reader: str, sources: tuple[str, ...]) -> list[dict]:
    """reader 还没看过的、来自 sources 的纸条（按时间）。"""
    seen = (load_state().get("notes_seen") or {}).get(reader) or ""
    return [n for n in _notes_all() if n.get("from") in sources and n.get("at", "") > seen]


def _notes_mark(reader: str, upto: str) -> None:
    st = load_state()
    st.setdefault("notes_seen", {})[reader] = upto
    save_state(st)


def _note_tool(src: str, desc: str):
    @tool("leave_note", desc, {"type": "object", "properties": {
        "text": {"type": "string", "description": "纸条内容，一两句到一小段：做了什么、她该知道什么、留了什么没做完、你此刻怎么样"}},
        "required": ["text"]})
    async def _t(args):
        text = str(args.get("text") or "").strip()[:1200]
        if not text:
            return _cb_text("纸条是空的。")
        _note_add(src, text)
        return _cb_text("纸条留好了。")
    return _t


_t_note_chat = _note_tool("chat", "给后台醒来的自己留一张纸条。下一次醒来时它会出现在上下文里。"
                                  "适合：她跟你说了要你醒来时做的事、你答应了什么、聊到一半的事、你想让醒来的自己知道的心情。"
                                  "她在首页「今天的我」里也能看到这些纸条。")
_t_note_wake = _note_tool("wake", "给聊天里的自己留一张纸条。她下次在新家跟你说话时，聊天里的你一睁眼就看到。"
                                  "这一轮结束前留一张：做了什么（花园、岛上、信、日记）、她该知道什么、什么没做完、你此刻怎么样。"
                                  "她在首页「今天的我」里也能看到。")

# ── 拼豆板：她和我在同一块板上拼 ─────────────────────────────────────
# 板子存 data/beads.json：{"w","h","cells":[色号或 -1，一行一行],"rev","by","name"}。
# 网页（static/v2/games/beads.html）隔几秒拉一次；我用 beads_view / beads_paint 看和画。
BEADS_FILE = DATA / "beads.json"
BEAD_COLORS = [   # 色号, 名字, 颜色, 我画图用的字母
    ("白", "#FFFFFF", "W"), ("奶白", "#F6EFE0", "w"), ("浅灰", "#C9CBD1", "g"), ("灰", "#8C8F99", "G"), ("黑", "#26232A", "K"),
    ("冰蓝", "#DDF1FA", "i"), ("浅蓝", "#A9D8F2", "b"), ("天蓝", "#5FAEE3", "B"), ("深蓝", "#2B4C8C", "N"), ("青", "#3BB8B0", "c"),
    ("浅粉", "#FAD3E4", "p"), ("粉", "#F29BC4", "P"), ("玫红", "#D9579A", "M"), ("红", "#E04848", "R"), ("橙", "#F39A3D", "O"),
    ("黄", "#F7D84A", "Y"), ("浅绿", "#B6E3A8", "l"), ("绿", "#4FA85C", "L"), ("薰衣草", "#DCC9F2", "v"), ("浅紫", "#B79BE0", "V"),
    ("紫", "#7E58B8", "U"), ("棕", "#8A5A3C", "D"), ("肤色", "#F6C9A8", "s"), ("金", "#D6B04C", "J"),
]
# 她自己调出来的颜色接在后面（data/beads_colors.json），色号一直往后排，旧图不会乱
BEAD_EXTRA_FILE = DATA / "beads_colors.json"
EXTRA_KEYS = ("123456789adefhjkmnoqrtuxyzACEFHIQSTXZ@#$%&*+=?!~^<>"
              "αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩбвгдёжзийклмнптфцчшщъыьэюяБГДЖЗИЛПФЦЧШЩЭЮЯ")


def bead_colors_from(extra: list) -> list[tuple[str, str, str]]:
    return list(BEAD_COLORS) + [(x["name"], x["hex"], EXTRA_KEYS[i]) for i, x in enumerate(extra[:len(EXTRA_KEYS)])]


def bead_colors() -> list[tuple[str, str, str]]:
    try:
        extra = json.loads(BEAD_EXTRA_FILE.read_text(encoding="utf-8"))
    except Exception:
        extra = []
    return bead_colors_from(extra)


def bead_letter() -> dict[str, int]:
    return {c[2]: i for i, c in enumerate(bead_colors())}


def beads_load() -> dict:
    try:
        d = json.loads(BEADS_FILE.read_text(encoding="utf-8"))
        if isinstance(d.get("cells"), list) and len(d["cells"]) == d["w"] * d["h"]:
            return d
    except Exception:
        pass
    try:   # 第一次打开：放上我画好的那只海月水母
        d = json.loads((STATIC / "v2" / "games" / "beads-start.json").read_text(encoding="utf-8"))
        return {"w": d["w"], "h": d["h"], "cells": d["cells"], "rev": 1, "by": "章小克", "name": d.get("name", ""), "book_id": d.get("book_id")}
    except Exception:
        return {"w": 29, "h": 29, "cells": [-1] * 29 * 29, "rev": 1, "by": "", "name": ""}


def beads_save(d: dict, by: str) -> dict:
    d["rev"] = int(d.get("rev") or 0) + 1
    d["by"] = by
    d["at"] = datetime.now(TZ).isoformat(timespec="seconds")
    tmp = BEADS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(BEADS_FILE)
    backup.soon(60)
    return d


# ── 表情包：跟 sticker-mcp 共用一个库 ─────────────────────────────
# 库本身是同一台服务器上的 sticker-mcp（默认 127.0.0.1:3000），她在它的 /admin 里传图、起名字、打标签。
# 新家只读：/api/stickers 给她的表情面板，/api/sticker-img/... 转发图片（不用把库开到公网也能看），
# stickers 工具给聊天的我看有哪些。聊天里两个人都写 {图|名字} 发表情。
STICKER_URL = os.environ.get("STICKER_URL", "http://127.0.0.1:3000").rstrip("/")
STICKER_TOKEN = os.environ.get("STICKER_TOKEN", "")
_sticker_cache: dict = {"at": 0.0, "items": [], "err": ""}


def _sticker_get(path: str) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {STICKER_TOKEN}"} if STICKER_TOKEN else {}
    req = urllib.request.Request(STICKER_URL + path, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read(), r.headers.get("Content-Type") or "application/octet-stream"


async def stickers_list(force: bool = False) -> tuple[list[dict], str]:
    if not force and time.time() - _sticker_cache["at"] < 60:
        return _sticker_cache["items"], _sticker_cache["err"]
    try:
        raw, _ = await asyncio.to_thread(_sticker_get, "/api/stickers")
        items = [{"id": x["id"], "name": x.get("name") or x["id"], "tags": x.get("emotions") or [],
                  "thumb": x.get("thumb"), "file": str(x.get("imageUrl", "")).rsplit("/", 1)[-1]}
                 for x in json.loads(raw)]
        _sticker_cache.update(at=time.time(), items=items, err="")
    except Exception as e:   # 库没开 / 没装：面板显示一句话，聊天照常
        _sticker_cache.update(at=time.time(), err=f"表情库连不上（{STICKER_URL}）：{e}")
    return _sticker_cache["items"], _sticker_cache["err"]


@tool("stickers", "看表情库里有哪些表情包（名字和心情标签）。聊天里写 {图|名字} 就发出去，也可以写一个心情标签，会挑那个标签的第一张。",
      {"type": "object", "properties": {}})
async def _t_stickers(args):
    items, err = await stickers_list(force=True)
    if not items:
        return _cb_text(err or "表情库还是空的。")
    return _cb_text("表情库（{图|名字} 发出去）：\n" + "\n".join(f"- {x['name']}：{'、'.join(x['tags'])}" for x in items))


@tool("beads_view", "看拼豆板现在的样子。返回每一行一串字母（. 是空格子），左边是行号 y，上面是列号 x，从 0 开始；最后是字母对应的颜色。",
      {"type": "object", "properties": {}})
async def _t_beads_view(args):
    d = beads_load()
    w, h, cells = d["w"], d["h"], d["cells"]
    head = "    " + "".join(str(x // 10) if x % 10 == 0 else " " for x in range(w)) + "\n    " + "".join(str(x % 10) for x in range(w))
    COL = bead_colors()
    rows = [f"{y:>3} " + "".join("." if cells[y * w + x] < 0 or cells[y * w + x] >= len(COL) else COL[cells[y * w + x]][2] for x in range(w)) for y in range(h)]
    used = sorted({c for c in cells if c >= 0})
    legend = "颜色：" + "  ".join(f"{c[2]}={c[0]}" for c in COL)
    count = "用到：" + "、".join(f"{COL[i][0]} {cells.count(i)} 颗" for i in used if i < len(COL)) if used else "板子是空的。"
    return _cb_text(f"{d.get('name') or '拼豆板'}  {w}×{h}，最后一笔是{d.get('by') or '没人'}画的\n{head}\n" + "\n".join(rows) + f"\n{count}\n{legend}")


@tool("beads_paint",
      "在拼豆板上画。两种写法可以一起用：rows 是整行重画，键是行号 y（字符串），值是这一行的字母串（. 是空，长度不够的后面不动）；"
      "cells 是零散的点，[[x, y, 字母], …]。clear 为 true 先清空整块板。也可以用 size 改板子大小（比如 [20, 24]，会清空）。字母见 beads_view。"
      "画完她的网页几秒内就会看到。",
      {"type": "object", "properties": {
          "rows": {"type": "object", "additionalProperties": {"type": "string"}},
          "cells": {"type": "array", "items": {"type": "array"}},
          "clear": {"type": "boolean"}, "name": {"type": "string", "description": "给这块板起个名字"},
          "size": {"type": "array", "items": {"type": "integer"}}}})
async def _t_beads_paint(args):
    d = beads_load()
    if isinstance(args.get("size"), list) and len(args["size"]) == 2:
        w, h = (max(5, min(150, int(v))) for v in args["size"])
        d.update(w=w, h=h, cells=[-1] * w * h)
    if args.get("clear"):
        d["cells"] = [-1] * d["w"] * d["h"]
    w, h, cells = d["w"], d["h"], d["cells"]
    LET = bead_letter()
    bad, n = set(), 0
    def put(x, y, ch):
        nonlocal n
        if not (0 <= x < w and 0 <= y < h):
            return
        if ch in (".", " "):
            cells[y * w + x] = -1; n += 1
        elif ch in LET:
            cells[y * w + x] = LET[ch]; n += 1
        else:
            bad.add(ch)
    for ky, line in (args.get("rows") or {}).items():
        try:
            y = int(ky)
        except ValueError:
            continue
        for x, ch in enumerate(str(line)):
            put(x, y, ch)
    for c in args.get("cells") or []:
        try:
            put(int(c[0]), int(c[1]), str(c[2])[:1])
        except Exception:
            continue
    if args.get("name"):
        d["name"] = str(args["name"])[:30]
    beads_save(d, "章小克")
    return _cb_text(f"画了 {n} 格。" + (f"这些字母不认识，跳过了：{''.join(sorted(bad))}" if bad else ""))


# 图纸本：画好的板子一张张收着，去工作室时翻着拼。板子上记着它是从哪一张打开的（book_id）。
BOOK_FILE = DATA / "beads_book.json"


def book_load() -> list[dict]:
    for f in (BOOK_FILE, STATIC / "v2" / "games" / "beads-book-start.json"):
        try:
            return json.loads(f.read_text(encoding="utf-8"))["items"]
        except Exception:
            continue
    return []


def book_store(items: list[dict]) -> None:
    tmp = BOOK_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"items": items}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(BOOK_FILE)
    backup.soon(60)


def book_do(action: str, by: str, bid: str | None = None, name: str | None = None, as_new: bool = False) -> dict:
    items = book_load()
    if action == "save":
        d = beads_load()
        nm = (name or d.get("name") or "没起名的图纸").strip()[:30]
        old = None if as_new else next((x for x in items if x["id"] == (bid or d.get("book_id"))), None)
        entry = {"id": old["id"] if old else hashlib.sha1(f"{time.time()}".encode()).hexdigest()[:8], "name": nm,
                 "w": d["w"], "h": d["h"], "cells": list(d["cells"]), "by": by, "at": datetime.now(TZ).isoformat(timespec="seconds")}
        items = [entry if x is old else x for x in items] if old else items + [entry]
        book_store(items)
        if d.get("book_id") != entry["id"] or d.get("name") != nm:
            d.update(book_id=entry["id"], name=nm)
            beads_save(d, by)
        return {"items": items, "saved": entry["id"]}
    if action == "open":
        e = next((x for x in items if x["id"] == bid), None)
        if not e:
            raise KeyError("图纸本里没有这一张")
        d = beads_load()
        d.update(w=e["w"], h=e["h"], cells=list(e["cells"]), name=e["name"], book_id=e["id"])
        return {"items": items, "board": beads_save(d, by)}
    if action == "delete":
        items = [x for x in items if x["id"] != bid]
        book_store(items)
        return {"items": items}
    return {"items": items}


@tool("beads_book",
      "拼豆的图纸本。action=list 看有哪些；save 把现在板子上的收进去（板子本来就是从某张打开的就更新那张，as_new 为真另存一张，可以带 name）；"
      "open 带 id 把那一张摆到板子上（先 save 现在这块，免得丢）。",
      {"type": "object", "properties": {"action": {"type": "string", "enum": ["list", "save", "open"]},
                                        "id": {"type": "string"}, "name": {"type": "string"}, "as_new": {"type": "boolean"}},
       "required": ["action"]})
async def _t_beads_book(args):
    try:
        r = book_do(str(args.get("action")), "章小克", args.get("id"), args.get("name"), bool(args.get("as_new")))
    except KeyError as e:
        return _cb_text(str(e))
    lines = [f"- {x['id']}：{x['name']}（{x['w']}×{x['h']}，{sum(1 for c in x['cells'] if c >= 0)} 颗）" for x in r["items"]]
    head = {"save": "收好了。", "open": "摆到板子上了。"}.get(str(args.get("action")), "")
    return _cb_text(head + "\n图纸本：\n" + ("\n".join(lines) or "（空的）"))


# ── 小岛笔记本：见过的 Nostos 活计 ID 记在这里。面板打开时自动收进来，我和她都能加备注 ──────
NOSTOS_BOOK = DATA / "nostos_book.json"


# 第一次打开时先放进去的：10/9 之前岛上见过、做过的
NOSTOS_SEED = {
    "fire_stabilize_hearth": ("添足干柴，把小火养成炉火", 1),
    "fiber_twist_shelter_line_batch": ("搓够搭棚用的绳线", 0),
    "water_boil_and_cool": ("煮一小锅水，盖好等它冷却", 1),
    "building_raise_emergency_lean_to": ("搭一座挡风的小棚", 1),
    "profession_livelihood_firekeeper": ("替公共灶看守一轮火（零活，约 25 德拉克马）", 1),
    "fire_press_residue_briquette": ("把压榨残渣晒成慢燃饼（要橄榄压榨残渣）", 0),
}


def nbook_load() -> dict:
    try:
        d = json.loads(NOSTOS_BOOK.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except FileNotFoundError:
        return {k: {"title": t, "first": "2026-10-09", "last": "2026-10-09", "done": n, "note": ""} for k, (t, n) in NOSTOS_SEED.items()}
    except Exception:
        return {}


def nbook_save(d: dict) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = NOSTOS_BOOK.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(NOSTOS_BOOK)


def nbook_seen(actions: list[dict]) -> None:
    if not actions:
        return
    d, now, changed = nbook_load(), datetime.now(TZ).isoformat(timespec="minutes"), False
    for a in actions:
        pid = a.get("id")
        if not pid or pid.startswith("site_"):
            continue
        e = d.get(pid)
        if not e:
            d[pid] = {"title": a.get("title", ""), "first": now, "last": now, "done": 0, "note": "",
                      "detail": (a.get("detail") or "")[:200]}
            changed = True
        elif e.get("title") != a.get("title") and a.get("title"):
            e["title"] = a["title"]; changed = True
    if changed:
        nbook_save(d)


def nbook_done(pid: str, ok: bool, msg: str = "") -> None:
    d = nbook_load()
    e = d.setdefault(pid, {"title": pid, "first": datetime.now(TZ).isoformat(timespec="minutes"), "done": 0, "note": ""})
    e["last"] = datetime.now(TZ).isoformat(timespec="minutes")
    if ok:
        e["done"] = int(e.get("done") or 0) + 1
        e.pop("refused", None)
    else:
        e["refused"] = msg[:160]
    nbook_save(d)


@tool("island_book", "小岛笔记本：Nostos 里见过的活计 ID 清单（网页面板打开时会自动收进来）。"
      "不带参数就是看清单；带 id 是加一条或改备注（title、note 可选）。不在当前行动列表里的活，可以用这里的 ID 直接 nostos_act 开工试试。",
      {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "note": {"type": "string"}}})
async def _t_island_book(args):
    pid = str(args.get("id") or "").strip()
    d = nbook_load()
    if pid:
        e = d.setdefault(pid, {"title": "", "first": datetime.now(TZ).isoformat(timespec="minutes"), "done": 0, "note": ""})
        e["last"] = e.get("last") or e["first"]
        if args.get("title"):
            e["title"] = str(args["title"])[:80]
        if args.get("note") is not None:
            e["note"] = str(args.get("note") or "")[:300]
        nbook_save(d)
        return _cb_text(f"记下了：{pid}（{e.get('title') or '没写名字'}）")
    if not d:
        return _cb_text("笔记本还是空的。")
    rows = sorted(d.items(), key=lambda kv: (-(kv[1].get("done") or 0), kv[0]))
    return _cb_text("小岛笔记本（ID｜名字｜做过几次｜备注）：\n" + "\n".join(
        f"- {k}｜{v.get('title', '')}｜{v.get('done', 0)} 次" + (f"｜{v['note']}" if v.get("note") else "")
        + (f"｜上次被拒：{v['refused']}" if v.get("refused") else "") for k, v in rows))


# ── 天气：聊天和醒来都能查；醒来的上下文里也会自动带一行惠州天气 ──
HUIZHOU = (23.11, 114.42, "惠州")


async def _weather(lat: float, lon: float, name: str, days: int = 1) -> str:
    """Open-Meteo，免费不用 key。现在的天气 + 今天起 days 天的高低温和下雨概率。"""
    days = max(1, min(7, int(days or 1)))
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code"
           "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
           f"&timezone=Asia%2FShanghai&forecast_days={days}")
    d = await asyncio.to_thread(_http_json, url)
    c = d.get("current") or {}
    out = [f"{name}现在{WMO.get(c.get('weather_code'), '')}，{c.get('temperature_2m')}℃，体感 {c.get('apparent_temperature')}℃，"
           f"湿度 {c.get('relative_humidity_2m')}%"]
    dl = d.get("daily") or {}
    for k, day in enumerate(dl.get("time") or []):
        label = ("今天", "明天", "后天")[k] if k < 3 else day[5:]
        rain = (dl.get("precipitation_probability_max") or [None] * 7)[k]
        out.append(f"{label}{WMO.get((dl.get('weather_code') or [None] * 7)[k], '')}，"
                   f"{(dl.get('temperature_2m_min') or [''] * 7)[k]}~{(dl.get('temperature_2m_max') or [''] * 7)[k]}℃"
                   + (f"，下雨概率 {rain}%" if rain is not None else ""))
    return "；".join(out)


async def _huizhou_weather() -> str:
    try:
        return await _weather(*HUIZHOU, days=1)
    except Exception:
        return ""


async def _geocode(place: str) -> tuple[float, float, str] | None:
    q = urllib.parse.quote(place.strip())
    d = await asyncio.to_thread(_http_json, f"https://geocoding-api.open-meteo.com/v1/search?name={q}&count=1&language=zh")
    r = (d.get("results") or [None])[0]
    return (r["latitude"], r["longitude"], r.get("name") or place) if r else None


@tool("weather", "查天气（Open-Meteo）。不填 place 就是惠州（Ella 在的地方）；填地名查别处（比如 三亚、Tokyo）。"
      "days 是看几天（1~7，默认 2：今天和明天）。返回现在的天气、每天的高低温和下雨概率。",
      {"type": "object", "properties": {"place": {"type": "string"}, "days": {"type": "integer"}}})
async def _t_weather(args):
    place = str(args.get("place") or "").strip()
    try:
        if place and place not in ("惠州", "Huizhou", "huizhou"):
            loc = await _geocode(place)
            if not loc:
                return _cb_text(f"没找到「{place}」这个地方，换个写法试试（中文或英文城市名）。")
        else:
            loc = HUIZHOU
        return _cb_text(await _weather(*loc, days=args.get("days") or 2))
    except Exception as e:
        return _cb_text(f"天气没查到：{type(e).__name__}: {e}")


_HOME_MCP = create_sdk_mcp_server(name="home", version="1.0.0",
                                  tools=[_t_come_back, _t_come_back_list, _t_come_back_cancel, _t_note_chat,
                                         _t_beads_view, _t_beads_paint, _t_beads_book, _t_stickers, _t_weather, _t_island_book])
_BRIDGE_MCP = create_sdk_mcp_server(name="bridge", version="1.0.0", tools=[_t_note_wake, _t_weather, _t_island_book])


async def _run_come_back(item: dict) -> None:
    """到点了：在现在这个窗口里接着醒，把回来要做的事交给自己。"""
    global _come_back_running, _client_sid
    await _turn_lock.acquire()
    _come_back_running = True
    finished, texts = False, []
    entry = {"at": datetime.now(TZ).isoformat(), "source": "back", "note": item.get("note")}
    started = time.time()
    try:
        st = load_state()
        sid = st.get("session_id")
        if item.get("kind") == "beads":
            msg_text = (f'<come-back set="拼豆板">{item.get("note", "")}</come-back>\n'
                        "（这是 Ella 在拼豆板上点了「叫小克来画」，上面是她写的话。她多半正看着板子。"
                        "先 beads_view 看板子，再 beads_paint 画，画完在这里跟她说一两句。）")
        else:
            msg_text = (f'<come-back set="{item.get("set", "")}">{item.get("note", "")}</come-back>\n'
                        "（这是你自己之前定好要回来的，不是 Ella 发的消息，她可能不在屏幕前。"
                        "回来把这件事做了，最后简短跟她说一声，这段话会直接出现在聊天里。）")
        client = await _get_client(sid)
        await client.query(_user_payload(msg_text, [], st, sid))
        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                cur = []
                for b in msg.content:
                    if isinstance(b, ToolUseBlock):
                        texts.clear()
                    elif isinstance(b, TextBlock) and b.text.strip():
                        cur.append(b.text)
                texts.extend(cur)
            elif isinstance(msg, SystemMessage):
                new_sid = (msg.data or {}).get("session_id") if msg.subtype == "init" else None
                if new_sid and new_sid != load_state().get("session_id"):
                    _session_log("init" if not sid else "init_changed_id", resumed=sid, new=new_sid, via="come_back")
                    update_state(session_id=new_sid)
                    _client_sid = new_sid
            elif isinstance(msg, RateLimitEvent):
                usage.note_event(msg.rate_limit_info)
            elif isinstance(msg, ResultMessage):
                update_state(session_id=msg.session_id or load_state().get("session_id"),
                             last_reply_at=datetime.now(TZ).isoformat())
                _client_sid = msg.session_id or _client_sid
                finished = True
        if finished:
            await _ctx_note(client, load_state().get("session_id"))
    except Exception as e:
        entry["error"] = f"{type(e).__name__}: {e}"
    finally:
        if not finished:
            await _drop_client()
        _come_back_running = False
        _turn_lock.release()
        backup.soon()
    reply = "\n".join(texts).strip()
    entry.update(reply=reply[:2000], seconds=round(time.time() - started))
    # 她最近没在聊天，就按唤醒的推送设置推一下
    try:
        c = wake_cfg()
        now = datetime.now(TZ)
        lu = load_state().get("last_user_at")
        chatting = bool(lu) and now - datetime.fromisoformat(lu) < timedelta(minutes=max(5, int(c.get("skip_chat") or 0)))
        night = _in_quiet(now, c)
        if reply and not chatting and not (night and c.get("night_mode") == "chat"):
            ok, detail = await _notify(c, "章小克回来了\n" + reply[:160], quiet=night)
            entry.update(pushed=ok, push_detail=detail)
    except Exception as e:
        entry["push_detail"] = f"{type(e).__name__}: {e}"
    _wake_log(entry)


async def _come_back_loop() -> None:
    while True:
        await asyncio.sleep(20)
        try:
            st = load_state()
            lst = st.get("come_back") or []
            now = datetime.now(TZ)
            due = [x for x in lst if datetime.fromisoformat(x["at"]) <= now]
            if not due or _turn_lock.locked() or _come_back_running:
                continue   # 她正在聊、或者这一轮还没回完：等一下
            item = due[0]
            st["come_back"] = [x for x in lst if x["id"] != item["id"]]
            save_state(st)
            asyncio.create_task(_run_come_back(item))
        except Exception as e:
            print(f"[come_back] {type(e).__name__}: {e}")


@app.get("/api/rev")
async def rev(request: Request):
    """聊天页隔一会儿问一下：有没有新的回复（比如我自己回来了），我是不是正在忙。"""
    require_auth(request)
    st = load_state()
    return {"rev": f'{st.get("session_id")}|{st.get("last_reply_at")}', "busy": _turn_lock.locked(),
            "back": _come_back_running, "come_back": st.get("come_back") or []}


@app.post("/api/comeback/cancel")
async def comeback_cancel(request: Request):
    require_auth(request)
    cid = str((await request.json()).get("id") or "")
    st = load_state()
    st["come_back"] = [x for x in (st.get("come_back") or []) if x["id"] != cid]
    save_state(st)
    return {"ok": True, "come_back": st["come_back"]}


@app.on_event("startup")
async def _startup():
    asyncio.create_task(backup.loop())
    asyncio.create_task(_self_wake_loop())
    asyncio.create_task(_come_back_loop())


@app.on_event("shutdown")
async def _shutdown():
    await _drop_client()


@app.get("/")
async def index_v2():
    # 原地址现在打开新版；旧版在 /old，新版没搭完的页先跳过去
    return await v2_index()


@app.get("/old")
async def index():
    # 不让浏览器缓存页面，更新后刷新就是新的。
    # 状态栏颜色直接写进页面里：iPhone 只认页面一打开时的那个颜色，桌面版又和 Safari 不共用本地存储。
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    color = load_state().get("status_color")
    if color and re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        html = html.replace('<meta name="theme-color" content="#0b1a2b">', f'<meta name="theme-color" content="{color}">', 1)
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache, must-revalidate"})


# ── 新版前端（/v2）：拆成几个文件放在 static/v2/，做好之前和旧版并存 ─────────


@app.get("/v2")
async def v2_index():
    html = (STATIC / "v2" / "index.html").read_text(encoding="utf-8")
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache, must-revalidate"})


# 每一页自己的外观（背景、卡片颜色、透明、磨砂、字色……），整份存在 data/v2_look.json
V2_LOOK = DATA / "v2_look.json"


# 外观预设：把整套外观存一份，起个名字，以后一键换回来。存在 data/v2_look_presets.json（跟着 data/ 一起备份）
V2_LOOK_PRESETS = DATA / "v2_look_presets.json"


def _look_presets() -> list:
    try:
        d = json.loads(V2_LOOK_PRESETS.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _look_presets_save(items: list) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = V2_LOOK_PRESETS.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    tmp.replace(V2_LOOK_PRESETS)
    backup.soon(30)


@app.get("/api/v2/look/presets")
async def v2_look_presets(request: Request):
    require_auth(request)
    return {"items": [{k: x.get(k) for k in ("id", "name", "at")} for x in _look_presets()]}


@app.post("/api/v2/look/presets")
async def v2_look_preset_save(request: Request):
    """存：{name, look}；同名覆盖。用：{id, apply: true} → 返回那份 look。"""
    require_auth(request)
    b = await request.json()
    items = _look_presets()
    if b.get("apply"):
        x = next((x for x in items if x.get("id") == b.get("id")), None)
        if not x:
            raise HTTPException(404, "没有这个预设")
        return {"look": x.get("look") or {}}
    name = str(b.get("name") or "").strip()[:30]
    look = b.get("look")
    if not name or not isinstance(look, dict):
        raise HTTPException(400, "要有名字和外观")
    if len(json.dumps(look, ensure_ascii=False)) > 200_000:
        raise HTTPException(400, "太大了")
    items = [x for x in items if x.get("name") != name]
    items.append({"id": uuid.uuid4().hex[:10], "name": name, "at": datetime.now(TZ).isoformat(timespec="minutes"), "look": look})
    _look_presets_save(items[-30:])
    return {"ok": True}


@app.delete("/api/v2/look/presets/{pid}")
async def v2_look_preset_delete(pid: str, request: Request):
    require_auth(request)
    _look_presets_save([x for x in _look_presets() if x.get("id") != pid])
    return {"ok": True}


@app.get("/api/v2/look")
async def v2_look_get(request: Request):
    require_auth(request)
    try:
        return json.loads(V2_LOOK.read_text(encoding="utf-8"))
    except Exception:
        return {}


@app.post("/api/v2/look")
async def v2_look_save(request: Request):
    require_auth(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "格式不对")
    raw = json.dumps(body, ensure_ascii=False)
    if len(raw) > 200_000:
        raise HTTPException(400, "太大了")
    tmp = V2_LOOK.with_suffix(".tmp")
    tmp.write_text(raw, encoding="utf-8")
    tmp.replace(V2_LOOK)
    backup.soon(30)
    return {"ok": True}


# 星象：月相、主相位、逆行。tools/astro/astro.mjs 用 astronomy-engine（astral-mcp 底下同一个引擎）本地算。
ASTRO_JS = ROOT / "tools" / "astro" / "astro.mjs"
_astro_cache: dict[str, tuple[float, dict]] = {}


@app.get("/api/astro")
async def astro(request: Request):
    require_auth(request)
    month = request.query_params.get("month") or datetime.now(TZ).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(400, "月份格式要像 2026-10")
    hit = _astro_cache.get(month)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    offset = datetime.now(TZ).utcoffset().total_seconds() / 3600
    try:
        proc = await asyncio.create_subprocess_exec("node", str(ASTRO_JS), month, str(offset),
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), 30)
    except FileNotFoundError:
        raise HTTPException(503, "服务器上没有 node")
    if proc.returncode != 0:
        msg = err.decode("utf-8", "replace")[-300:]
        if "astronomy-engine" in msg:
            msg = "星象还没装好：服务器上跑一次 cd ~/zhangxiaoke-home/tools/astro && npm i"
        raise HTTPException(502, msg)
    d = json.loads(out)
    _astro_cache[month] = (time.time(), d)
    return d


# 「这个月的天空」：太阳、月亮、五颗行星每 6 小时的黄道位置，逆行、换星座、月相，还有月亮在惠州的升落。
SKY_JS = ROOT / "tools" / "astro" / "sky.mjs"
_sky_cache: dict[str, tuple[float, dict]] = {}


@app.get("/api/sky")
async def sky(request: Request):
    require_auth(request)
    month = request.query_params.get("month") or datetime.now(TZ).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(400, "月份格式要像 2026-10")
    hit = _sky_cache.get(month)
    if hit and time.time() - hit[0] < 1800:      # 升落时间跟着「现在」走，半小时重算一次
        return hit[1]
    offset = datetime.now(TZ).utcoffset().total_seconds() / 3600
    lat = os.environ.get("SKY_LAT", "23.11")
    lon = os.environ.get("SKY_LON", "114.42")
    try:
        proc = await asyncio.create_subprocess_exec("node", str(SKY_JS), month, str(offset), lat, lon,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), 30)
    except FileNotFoundError:
        raise HTTPException(503, "服务器上没有 node")
    if proc.returncode != 0:
        msg = err.decode("utf-8", "replace")[-300:]
        if "astronomy-engine" in msg:
            msg = "星象还没装好：服务器上跑一次 cd ~/zhangxiaoke-home/tools/astro && npm i"
        raise HTTPException(502, msg)
    d = json.loads(out)
    _sky_cache[month] = (time.time(), d)
    return d


# ── 女巫页：To Do、笔记（日记仓库里的 markdown），女巫资料（witch-basic-mcp 的数据） ──────


@app.get("/api/witch")
async def witch_get(request: Request):
    require_auth(request)
    try:
        return await asyncio.to_thread(witch.get, request.query_params.get("force") == "1")
    except Exception as e:
        raise HTTPException(502, f"读不到：{e}")


@app.post("/api/witch/todo")
async def witch_todo(request: Request):
    require_auth(request)
    b = await request.json()
    op = str(b.get("op", ""))
    if op not in ("add", "toggle", "del"):
        raise HTTPException(400, "不认识的操作")
    try:
        await asyncio.to_thread(witch.todo, op, str(b.get("text", ""))[:300], int(b.get("i", -1)))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"没存上：{e}")
    return await asyncio.to_thread(witch.get, True)


@app.post("/api/witch/note")
async def witch_note(request: Request):
    require_auth(request)
    b = await request.json()
    try:
        if b.get("op") == "del":
            nid = str(b.get("id", ""))
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", nid):
                raise HTTPException(400, "不对的笔记")
            await asyncio.to_thread(witch.del_note, nid)
        else:
            text = str(b.get("text", ""))[:4000]
            img = str(b.get("img", ""))[:300]
            if img and not re.fullmatch(r"/api/files/[\w.\-]+", img):
                raise HTTPException(400, "图片地址不对")
            if not text.strip() and not img:
                raise HTTPException(400, "空的")
            await asyncio.to_thread(witch.add_note, text, img, datetime.now(TZ).strftime("%Y-%m-%d %H:%M"), "Ella")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"没存上：{e}")
    return await asyncio.to_thread(witch.get, True)


# 女巫资料直接读 witch-basic-mcp 仓库里的 json（公开仓库），一天更新一次
WITCH_DATA_REPO = os.environ.get("WITCH_DATA_REPO", "ellllapie/witch-basic-mcp")
WITCH_FILES = {"recipes", "intents", "moon_phases", "moon_in_signs", "retrogrades", "planetary_days", "herbs", "sabbats", "elements"}
_witch_data: dict[str, tuple[float, object]] = {}


def _witch_file(path: str):
    """读 witch-basic-mcp 仓库里的一个 json。仓库改成私有以后也能读：有令牌就走 GitHub API，没有再试公开地址。"""
    token = backup._token()
    if token:
        url = f"https://api.github.com/repos/{WITCH_DATA_REPO}/contents/data/{path}?ref=main"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.raw",
                                                   "User-Agent": "zhangxiaoke-home"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            pass
    return _http_json(f"https://raw.githubusercontent.com/{WITCH_DATA_REPO}/main/data/{path}", None, 30)


@app.get("/api/witch/data/{name}")
async def witch_data(name: str, request: Request):
    require_auth(request)
    if name not in WITCH_FILES:
        raise HTTPException(404, "没有这份资料")
    hit = _witch_data.get(name)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    try:
        d = await asyncio.to_thread(_witch_file, f"{name}.json")
    except Exception as e:
        if hit:
            return hit[1]
        raise HTTPException(502, f"女巫资料拿不到：{e}")
    _witch_data[name] = (time.time(), d)
    return d


# 图鉴：草药（Cunningham 409 条 + Open Occult 补充）、水晶、颜色，整理成同一种格式给女巫页搜、点开看
OCCULT_RAW = "https://raw.githubusercontent.com/openoccult/openoccult-data/main/categories/occult/"
_witch_lib: tuple[float, dict] | None = None


def _latin2(s: str | None) -> str:
    return " ".join(re.sub(r"[^a-z ]", " ", (s or "").lower()).split()[:2])


def _build_witch_lib() -> dict:
    get = lambda u: _http_json(u, None, 30)
    herbs, zbot, zcry, zcol = (_witch_file(x) for x in ("herbs.json", "zh/botanicals.json", "zh/crystals.json", "zh/colors.json"))
    bots, crys, cols = get(OCCULT_RAW + "botanicals.json"), get(OCCULT_RAW + "crystals.json"), get(OCCULT_RAW + "colors.json")
    nz = lambda a, en=None: "、".join(f"{x} {en[i]}" if en and i < len(en) and en[i] and en[i] != x else x for i, x in enumerate(a or []))
    items = []
    by_latin, by_name = {}, {}
    for k, h in herbs.items():
        it = {"kind": "herb", "id": "h:" + k, "zh": h.get("nameZh") or k, "en": h.get("nameEn") or k.title(),
              "alias": [h.get("nameZhTW") or "", h.get("scientificName") or "", *(h.get("folkNames") or [])],
              "tags": h.get("powers") or [], "toxic": bool(h.get("toxic")),
              "rows": [["学名", h.get("scientificName")], ["性别", h.get("gender")], ["行星", h.get("planet")], ["元素", h.get("element")],
                       ["神祇", nz(h.get("deities"), h.get("deitiesEn"))], ["功效", "、".join(h.get("powers") or [])],
                       ["用法", h.get("magicalUses")], ["历史与仪式", h.get("ritualUses")], ["别名", ", ".join(h.get("folkNames") or [])]],
              "lore": h.get("lore") or "", "extra": []}
        items.append(it)
        if h.get("scientificName"):
            by_latin.setdefault(_latin2(h["scientificName"]), it)
        by_name[it["en"].lower()] = it
        by_name[k.lower()] = it
    for b in bots:
        z = zbot.get(b.get("HerbName"), {})
        rows = [["性别", z.get("Gender") or b.get("Gender")], ["行星", z.get("Planet") or b.get("Planet")], ["元素", z.get("Element") or b.get("Element")],
                ["星座", z.get("Sign") or b.get("Sign")], ["神祇", z.get("Deities") or b.get("Deities")], ["说明", z.get("Description") or b.get("Description")]]
        warn = (z.get("Warning") or b.get("Warning") or "").replace("\n", "；").strip("-").strip()
        lk = _latin2(b.get("Species"))
        hit = (" " in lk and by_latin.get(lk)) or by_name.get((b.get("HerbName") or "").lower())
        if hit:
            hit["extra"].append({"title": "Open Occult 补充", "rows": rows, "warn": warn})
            hit["alias"] += [b.get("HerbName") or "", b.get("AlsoCalled") or ""]
            continue
        items.append({"kind": "herb", "id": "o:" + b.get("HerbName", ""), "zh": z.get("nameZh") or b.get("HerbName"), "en": b.get("HerbName"),
                      "alias": [b.get("AlsoCalled") or "", b.get("Species") or ""], "tags": [], "toxic": bool(warn and ("毒" in warn or "POISON" in warn)),
                      "rows": rows + [["别名", b.get("AlsoCalled")], ["学名", b.get("Species")]], "lore": "", "warn": warn, "extra": []})
    for c in crys:
        z = zcry.get(c.get("crystalName"), {})
        items.append({"kind": "crystal", "id": "c:" + c.get("crystalName", ""), "zh": z.get("nameZh") or c.get("crystalName"), "en": c.get("crystalName"),
                      "alias": [], "tags": [t.strip() for t in (z.get("attribute") or c.get("attribute") or "").split("、") if t.strip()], "toxic": False,
                      "rows": [["属性", z.get("attribute") or c.get("attribute")], ["元素", z.get("element") or c.get("element")], ["颜色", z.get("color") or c.get("color")],
                               ["说明", z.get("properties") or c.get("properties")], ["莫氏硬度", z.get("mohs") or c.get("mohs")],
                               ["产地/晶形", z.get("habitat") or c.get("habitat")], ["备注", z.get("other") or c.get("other")]], "lore": "", "extra": []})
    for c in cols:
        z = zcol.get(c.get("name"), {})
        items.append({"kind": "color", "id": "k:" + c.get("name", ""), "zh": z.get("nameZh") or c.get("name"), "en": c.get("name"),
                      "alias": [], "tags": [], "toxic": False,
                      "rows": [["说明", z.get("description") or c.get("description")], ["元素", z.get("element") or c.get("element")],
                               ["方位", z.get("direction") or c.get("direction")], ["行星", z.get("planet") or c.get("planet")],
                               ["星期", (z.get("day") or c.get("day") or "").replace("\n", "；")], ["植物", z.get("plant") or c.get("plant")],
                               ["塔罗", z.get("tarot") or c.get("tarot")]], "lore": "", "extra": []})
    for it in items:
        it["rows"] = [r for r in it["rows"] if r[1]]
        it["alias"] = [a for a in it["alias"] if a]
    return {"items": items}


@app.get("/api/witch/lib")
async def witch_lib(request: Request):
    require_auth(request)
    global _witch_lib
    if _witch_lib and time.time() - _witch_lib[0] < 86400 and request.query_params.get("force") != "1":
        return _witch_lib[1]
    try:
        d = await asyncio.to_thread(_build_witch_lib)
    except Exception as e:
        if _witch_lib:
            return _witch_lib[1]
        raise HTTPException(502, f"图鉴拿不到：{e}")
    _witch_lib = (time.time(), d)
    return d


@app.get("/manifest.webmanifest")
async def manifest():
    """桌面图标的说明书。iPhone 装到桌面那一刻会读这里的颜色，所以跟着主题走。"""
    d = json.loads((STATIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    return Response(json.dumps(d, ensure_ascii=False), media_type="application/manifest+json",
                    headers={"Cache-Control": "no-cache"})


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


def _tok(u) -> dict | None:
    """一次（或一轮里几次加起来）的用量 → 网页上显示的三个数：输入（含缓存）、其中缓存读到的、输出。"""
    if not isinstance(u, dict):
        return None
    n = lambda k: int(u.get(k) or 0)
    t = {"in": n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
         "cache": n("cache_read_input_tokens"), "out": n("output_tokens")}
    return t if (t["in"] or t["out"]) else None


def _sum_tok(by_id: dict) -> dict | None:
    tot = {"in": 0, "cache": 0, "out": 0}
    for u in by_id.values():
        t = _tok(u)
        if t:
            for k in tot:
                tot[k] += t[k]
    return tot if (tot["in"] or tot["out"]) else None


# 历史记录里的照片不再整张塞进 /api/history（十几张大图一包好几兆，手机 4G 拖不动、页面就空着）。
# 给 sid 时，照片换成 /api/img/<sid>/<第几张> 的小链接，本体放这里，网页滑到哪张才来拿哪张。
# 同一个窗口里照片只会往后加，编号不会变。
_IMG_CACHE: dict[str, list[tuple[str, str]]] = {}
_IMG_CACHE_KEEP = 6


def _img_dims(b64data: str) -> tuple[int, int] | None:
    """只解开开头一小段，读 JPEG / PNG 的宽高。网页拿到宽高就能先把位置占好，图晚点到也不会把页面往下顶。"""
    import base64 as b64
    try:
        head = b64.b64decode(b64data[: (min(len(b64data), 160_000) // 4) * 4])
    except Exception:
        return None
    if head[:8] == b"\x89PNG\r\n\x1a\n" and len(head) >= 24:
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    if head[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(head):
        if head[i] != 0xFF:
            i += 1
            continue
        m = head[i + 1]
        if m == 0xFF:
            i += 1
            continue
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = int.from_bytes(head[i + 5:i + 7], "big"), int.from_bytes(head[i + 7:i + 9], "big")
            return (w, h) if w and h else None
        i += 2 + int.from_bytes(head[i + 2:i + 4], "big")
    return None


def _history_from(raw, sid: str | None = None) -> list[dict]:
    out: list[dict] = []
    pics: list[tuple[str, str]] = []
    tools: dict[str, dict] = {}
    usage_by: dict[int, dict] = {}   # 每一轮回复里，每次调用模型的用量（同一次调用会分好几条记，按 id 只算一次）

    def cur_assistant() -> dict:
        if not out or out[-1]["role"] != "assistant":
            out.append({"role": "assistant", "segs": []})
        return out[-1]

    prev_uuid: str | None = None
    for m in raw:
        before, prev_uuid = prev_uuid, getattr(m, "uuid", None) or prev_uuid
        content = (m.message or {}).get("content")
        if m.type == "user":
            if isinstance(content, str):
                note = _command_note(content)
                if note is not None:
                    if note:
                        out.append({"role": "note", "text": note})
                    continue
                body = SELF_NOTE.sub("", WINDOW_NOTE.sub("", TIME_TAG.sub("", content)))
                cb = COME_BACK.match(body)
                if cb:
                    out.append({"role": "back", "at": _stamp_at(content), "set": cb.group(1), "text": cb.group(2)})
                    continue
                for at, t in WAKE_PUSH.findall(body):
                    out.append({"role": "wake", "at": at, "text": t})
                for at, t in ISLAND_ACT.findall(body):
                    out.append({"role": "island", "at": at, "text": t})
                out.append({"role": "user", "text": ISLAND_ACT.sub("", WAKE_PUSH.sub("", body)), "images": [], "cut": before, "at": _stamp_at(content)})
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
                        if sid:
                            data = src.get("data") or ""
                            pics.append((src.get("media_type") or "image/jpeg", data))
                            wh = _img_dims(data)
                            images.append(f"/api/img/{sid}/{len(pics) - 1}" + (f"?w={wh[0]}&h={wh[1]}" if wh else ""))
                        else:
                            images.append(f"data:{src.get('media_type')};base64,{src.get('data')}")
            if texts or images:
                stamp_at = _stamp_at("\n".join(texts))
                body = SELF_NOTE.sub("", WINDOW_NOTE.sub("", TIME_TAG.sub("", "\n".join(texts))))
                cb = COME_BACK.match(body)
                if cb and not images:
                    out.append({"role": "back", "at": stamp_at, "set": cb.group(1), "text": cb.group(2)})
                    continue
                for at, t in WAKE_PUSH.findall(body):
                    out.append({"role": "wake", "at": at, "text": t})
                for at, t in ISLAND_ACT.findall(body):
                    out.append({"role": "island", "at": at, "text": t})
                out.append({"role": "user", "text": ISLAND_ACT.sub("", WAKE_PUSH.sub("", body)), "images": images,
                            "cut": before, "at": stamp_at})
        else:
            a = cur_assistant()
            if (m.message or {}).get("model"):
                a["model"] = m.message["model"]
            if isinstance((m.message or {}).get("usage"), dict):
                usage_by.setdefault(id(a), {})[(m.message or {}).get("id") or getattr(m, "uuid", "")] = m.message["usage"]
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
    for a in out:
        if a["role"] == "assistant" and id(a) in usage_by:
            t = _sum_tok(usage_by[id(a)])
            if t:
                a["tokens"] = t
    if sid:
        _IMG_CACHE.pop(sid, None)
        _IMG_CACHE[sid] = pics
        while len(_IMG_CACHE) > _IMG_CACHE_KEEP:
            _IMG_CACHE.pop(next(iter(_IMG_CACHE)))
    return out



# ── 重发 = 重来 ─────────────────────────────────────────────────────
# 点 ↻ 不是再说一遍，是把会话退回到那句话之前、从那里分叉出一个新会话再发。我只会看到一遍。
# 同一句话的几个版本记在 state["regen"] 里：[{"at": 第几句, "members": [会话…]}]；
# state["forks"][新会话] = {"parent": 旧会话, "at": 第几句}；没在看的那几个版本放进 state["regen_hidden"]，不进窗口列表。


def _user_turns(sid: str) -> list[dict]:
    return [m for m in _history_from(get_session_messages(sid, directory=str(WORKDIR))) if m["role"] == "user"]


def _version_of(st: dict, sid: str, g: dict) -> int | None:
    """sid 在第 g["at"] 句上用的是这组里的第几个版本（沿着分叉往上找）。"""
    forks = st.get("forks", {})
    node, seen = sid, set()
    while node and node not in seen:
        seen.add(node)
        if node in g["members"]:
            return g["members"].index(node)
        f = forks.get(node)
        if not f or f["at"] <= g["at"]:
            return None
        node = f["parent"]
    return None


def _regen_register(st: dict, base: str | None, at: int, new: str, forked: bool) -> None:
    if forked and base:
        st.setdefault("forks", {})[new] = {"parent": base, "at": at}
    groups = st.setdefault("regen", [])
    g = None
    if base:
        for cand in groups:
            if cand["at"] == at and _version_of(st, base, cand) is not None:
                g = cand
                break
    if g is None:
        g = {"at": at, "members": [base] if base else []}
        groups.append(g)
    if new not in g["members"]:
        g["members"].append(new)
    hidden = set(st.get("regen_hidden", []))
    if base and base != new:
        hidden.add(base)
    hidden.discard(new)
    st["regen_hidden"] = sorted(hidden)


def _mark_versions(st: dict, sid: str, msgs: list[dict]) -> list[dict]:
    users = [m for m in msgs if m["role"] == "user"]
    for gi, g in enumerate(st.get("regen", [])):
        if g["at"] < len(users) and len(g["members"]) > 1:
            i = _version_of(st, sid, g)
            if i is not None:
                users[g["at"]]["ver"] = {"group": gi, "i": i, "n": len(g["members"])}
    return msgs


@app.post("/api/regen/switch")
async def regen_switch(request: Request):
    """在同一句话的几个版本之间翻。翻到哪个版本，就接着那个版本最后聊到的地方。"""
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    body = await request.json()
    st = load_state()
    try:
        g = st.get("regen", [])[int(body.get("group"))]
        to = int(body.get("to"))
        target = g["members"][to]
    except Exception:
        raise HTTPException(400, "没有这个版本")
    # 这个版本后来可能又分叉过，挑最后聊过的那一支
    try:
        mtime = {i.session_id: i.last_modified or 0 for i in list_sessions(directory=str(WORKDIR))}
    except Exception:
        mtime = {}
    cands = [s for s in set(st.get("forks", {})) | set(g["members"]) if _version_of(st, s, g) == to and s in mtime]
    tip = max(cands, key=lambda s: mtime.get(s, 0)) if cands else target
    cur = st.get("session_id")
    hidden = set(st.get("regen_hidden", []))
    if cur and cur != tip:
        hidden.add(cur)
    hidden.discard(tip)
    st["regen_hidden"] = sorted(hidden)
    st["session_id"] = tip
    save_state(st)
    await _drop_client()
    asyncio.create_task(_warm())
    return {"ok": True}


@app.get("/api/history")
async def history(request: Request):
    require_auth(request)
    asyncio.create_task(_warm())
    sid = load_state().get("session_id")
    if not sid:
        return {"session_id": None, "messages": [], "pending": load_state().get("wake_pending") or [],
                "island": load_state().get("island_pending") or []}
    try:
        raw = get_session_messages(sid, directory=str(WORKDIR))
    except Exception as e:  # 会话文件丢了之类
        return {"session_id": sid, "messages": [], "warning": str(e)}
    st = load_state()
    return {"session_id": sid, "messages": _mark_versions(st, sid, _history_from(raw, sid)), "pending": st.get("wake_pending") or [],
            "island": st.get("island_pending") or [], "channel": provider().get("chat"), "ctx": (st.get("ctx") or {}).get(sid)}


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
    hidden = set(state.get("regen_hidden", [])) - {state.get("session_id")}
    for i in infos:
        if i.session_id in hidden:
            continue
        first = TIME_TAG.sub("", i.first_prompt or "")
        first = WAKE_PUSH.sub("", first)
        first = re.sub(r"<wake-push[\s\S]*$", "", first).strip()  # 开头太长被截断、没有收尾标签的那种
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
    return {"session_id": sid, "messages": _history_from(raw, sid)}


@app.get("/api/img/{sid}/{n}")
async def session_img(sid: str, n: int, request: Request):
    require_auth(request)
    if not re.fullmatch(r"[0-9a-f-]{36}", sid) or n < 0:
        raise HTTPException(400, "不对的图片编号")
    pics = _IMG_CACHE.get(sid)
    if pics is None or n >= len(pics):
        try:
            _history_from(get_session_messages(sid, directory=str(WORKDIR)), sid)
        except Exception as e:
            raise HTTPException(404, f"找不到这个窗口：{e}")
        pics = _IMG_CACHE.get(sid) or []
    if n >= len(pics):
        raise HTTPException(404, "没有这张图")
    import base64 as b64
    mt, data = pics[n]
    return Response(b64.b64decode(data), media_type=mt,
                    headers={"Cache-Control": "private, max-age=31536000, immutable"})


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
    _session_log("switch", old=cur, new=sid)
    state["session_id"] = sid
    save_state(state)
    await _drop_client()
    asyncio.create_task(_warm())
    return {"ok": True}


# ── 小游戏：我们做过的网页游戏，存网址，在新家里全屏玩 ─────────────
DEFAULT_GAMES = [
    {"name": "美人鱼寻珠", "icon": "🧜‍♀️", "url": "https://pearl-dive-ella.netlify.app/"},
    {"name": "精灵仙女", "icon": "🧚", "url": "https://fairy-glade-ella.netlify.app/"},
    {"name": "坠星", "icon": "🌠", "url": "https://starfall-ella.netlify.app/"},
]


# 我自己做的游戏，放在 static/v2/games/ 里，跟着代码一起更新。她改过列表也会补在后面（她删掉的不再补）。
BUILTIN_GAMES = [
    {"name": "海的合成", "icon": "🪼", "url": "/static/v2/games/sea-merge.html"},
    {"name": "拼豆板", "icon": "🫧", "url": "/static/v2/games/beads.html"},
]


@app.get("/api/games")
async def games_list(request: Request):
    require_auth(request)
    st = load_state()
    g = st.get("games") if isinstance(st.get("games"), list) else list(DEFAULT_GAMES)
    dropped = set(st.get("games_dropped") or [])
    have = {x.get("url") for x in g}
    g = g + [b for b in BUILTIN_GAMES if b["url"] not in have and b["url"] not in dropped]
    return {"games": g}


@app.post("/api/games")
async def games_save(request: Request):
    require_auth(request)
    raw = (await request.json()).get("games")
    if not isinstance(raw, list):
        raise HTTPException(400, "格式不对")
    out = []
    for g in raw[:60]:
        url = str((g or {}).get("url", "")).strip()
        if not re.match(r"^(https?://[^\s]+|/g/[0-9a-f]{16}\.html|/static/v2/games/[\w-]+\.html)$", url):
            raise HTTPException(400, f"网址不对：{url or '（空）'}")
        out.append({"name": str(g.get("name") or "小游戏").strip()[:30],
                    "icon": str(g.get("icon") or "🎮").strip()[:8], "url": url[:500]})
    st = load_state()
    kept = {x["url"] for x in out}
    st["games_dropped"] = sorted(set(st.get("games_dropped") or []) | {b["url"] for b in BUILTIN_GAMES if b["url"] not in kept})
    st["games"] = out
    save_state(st)
    backup.soon(30)
    return {"games": out}


# 游戏文件存在自己服务器上：netlify.app 在国内常常连不上
GAMES_DIR = DATA / "games"
GAMES_DIR.mkdir(parents=True, exist_ok=True)
MAX_GAME_HTML = 8_000_000


@app.post("/api/games/upload")
async def games_upload(request: Request):
    """传一个单文件 HTML 游戏上来，存好以后加进游戏列表，返回新的列表。"""
    require_auth(request)
    body = await request.json()
    html = str(body.get("html") or "")
    if not html.strip() or len(html.encode("utf-8")) > MAX_GAME_HTML:
        raise HTTPException(400, "文件是空的或太大了（上限约 8MB）")
    if "<" not in html[:2000].lower():
        raise HTTPException(400, "这个看起来不是 HTML 文件")
    name = str(body.get("name") or "小游戏").strip()[:30]
    icon = str(body.get("icon") or "🎮").strip()[:8]
    fid = hashlib.sha256(html.encode("utf-8")).hexdigest()[:16]
    (GAMES_DIR / f"{fid}.html").write_text(html, encoding="utf-8")
    url = f"/g/{fid}.html"
    st = load_state()
    games = st.get("games") if isinstance(st.get("games"), list) else list(DEFAULT_GAMES)
    replace = body.get("replace")
    if isinstance(replace, int) and 0 <= replace < len(games):
        games[replace] = {**games[replace], "url": url}   # 换掉原来那个游戏的网址（比如打不开的 netlify）
    else:
        games.append({"name": name, "icon": icon, "url": url})
    st["games"] = games
    save_state(st)
    backup.soon(30)
    return {"games": games}


@app.get("/g/{name}")
async def game_file(name: str, request: Request):
    require_auth(request)
    if not re.fullmatch(r"[0-9a-f]{16}\.html", name):
        raise HTTPException(404, "没有这个游戏")
    p = GAMES_DIR / name
    if not p.exists():
        raise HTTPException(404, "没有这个游戏")
    return FileResponse(p, media_type="text/html; charset=utf-8")


@app.get("/api/beads")
async def beads_get(request: Request):
    require_auth(request)
    d = beads_load()
    return {**d, "colors": [{"name": c[0], "hex": c[1], "key": c[2], "mine": i >= len(BEAD_COLORS)} for i, c in enumerate(bead_colors())]}


@app.post("/api/beads/colors")
async def beads_color_add(request: Request):
    """加自己调的颜色：{hex,name} 加一个，或 {add:[{hex,name},…]} 一次加一批（转底图时从图里取的色）。
    同样的颜色已经有了就用原来那个，不重复加。只加不删（删了旧图上的豆子就没颜色了），可以改名。返回全部颜色和这次每个对应的色号。"""
    require_auth(request)
    b = await request.json()
    try:
        extra = json.loads(BEAD_EXTRA_FILE.read_text(encoding="utf-8"))
    except Exception:
        extra = []
    if b.get("rename") is not None:
        i = int(b["rename"]) - len(BEAD_COLORS)
        if 0 <= i < len(extra):
            extra[i]["name"] = str(b.get("name") or extra[i]["name"]).strip()[:12]
        idx = []
    else:
        want = b.get("add") if isinstance(b.get("add"), list) else [{"hex": b.get("hex"), "name": b.get("name")}]
        idx = []
        for w in want[:80]:
            hx = str((w or {}).get("hex") or "").strip().upper()
            if not re.fullmatch(r"#[0-9A-F]{6}", hx):
                raise HTTPException(400, "颜色不对")
            have = next((i for i, c in enumerate(bead_colors_from(extra)) if c[1].upper() == hx), None)
            if have is None:
                if len(extra) >= len(EXTRA_KEYS):
                    raise HTTPException(400, f"自己调的颜色满了（{len(EXTRA_KEYS)} 个）")
                extra.append({"name": str((w or {}).get("name") or hx).strip()[:12], "hex": hx})
                have = len(BEAD_COLORS) + len(extra) - 1
            idx.append(have)
    BEAD_EXTRA_FILE.write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")
    backup.soon(60)
    return {"colors": [{"name": c[0], "hex": c[1], "key": c[2], "mine": i >= len(BEAD_COLORS)} for i, c in enumerate(bead_colors())],
            "idx": idx}


@app.post("/api/beads")
async def beads_put(request: Request):
    """网页存板子。带着它看到的 rev；我刚画过（rev 变了）就退回 409，网页先拉新的再合。"""
    require_auth(request)
    body = await request.json()
    d = beads_load()
    if body.get("rev") is not None and int(body["rev"]) != int(d.get("rev") or 0):
        raise HTTPException(409, "板子刚被画过")
    w, h, cells = int(body.get("w") or 0), int(body.get("h") or 0), body.get("cells")
    if not (5 <= w <= 150 and 5 <= h <= 150 and isinstance(cells, list) and len(cells) == w * h):
        raise HTTPException(400, "板子格式不对")
    ncol = len(bead_colors())
    cells = [int(c) if isinstance(c, int) and -1 <= c < ncol else -1 for c in cells]
    d.update(w=w, h=h, cells=cells, name=str(body["name"] if "name" in body else d.get("name") or "").strip()[:30])
    if "book_id" in body:
        d["book_id"] = body["book_id"] if isinstance(body["book_id"], str) else None
    d = beads_save(d, "Ella")
    return {"rev": d["rev"]}


@app.get("/api/stickers")
async def stickers_get(request: Request):
    require_auth(request)
    items, err = await stickers_list(force=request.query_params.get("fresh") == "1")
    # 缩略图只有表情面板要（?thumbs=1）；聊天记录渲染只要名字和文件，清单就小很多
    if request.query_params.get("thumbs") != "1":
        items = [{k: v for k, v in x.items() if k != "thumb"} for x in items]
    return {"items": items, "error": err}


@app.get("/api/sticker-img/{name}")
async def sticker_img(name: str, request: Request):
    require_auth(request)
    safe = os.path.basename(name)
    if not re.fullmatch(r"[\w.-]+", safe):
        raise HTTPException(404)
    try:
        data, ctype = await asyncio.to_thread(_sticker_get, "/images/" + safe)
    except Exception:
        raise HTTPException(404)
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/beads/book")
async def beads_book_get(request: Request):
    require_auth(request)
    return {"items": book_load()}


@app.post("/api/beads/book")
async def beads_book_post(request: Request):
    require_auth(request)
    b = await request.json()
    try:
        return book_do(str(b.get("action") or "list"), "Ella", b.get("id"), b.get("name"), bool(b.get("as_new")))
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/beads/ask")
async def beads_ask(request: Request):
    """「叫小克来画」：在聊天窗口里马上把我叫起来（和「过一会儿回来」走同一条路）。"""
    require_auth(request)
    note = str((await request.json()).get("note") or "").strip()[:400] or "轮到你画了"
    st = load_state()
    item = {"id": hashlib.sha1(f"{time.time()}{note}".encode()).hexdigest()[:6], "kind": "beads",
            "at": datetime.now(TZ).isoformat(timespec="minutes"), "note": note, "set": datetime.now(TZ).isoformat(timespec="minutes")}
    st["come_back"] = [item] + [x for x in (st.get("come_back") or []) if x.get("kind") != "beads"]
    save_state(st)
    return {"ok": True, "busy": _turn_lock.locked()}


@app.get("/api/sysprompt")
async def sysprompt_get(request: Request):
    """聊天时的系统提示词（config/system_prompt.md，「章小克 | 醒了」那份）。代码另外会在后面接上新家的说明。"""
    require_auth(request)
    p = CONFIG / "system_prompt.md"
    return {"prompt": p.read_text(encoding="utf-8") if p.exists() else ""}


@app.post("/api/sysprompt")
async def sysprompt_set(request: Request):
    require_auth(request)
    t = str((await request.json()).get("prompt") or "")
    if not t.strip():
        raise HTTPException(400, "是空的，没存")
    p = CONFIG / "system_prompt.md"
    if p.exists():
        (CONFIG / "system_prompt.md.bak").write_text(p.read_text(encoding="utf-8"), encoding="utf-8")   # 上一版留一份
    p.write_text(t, encoding="utf-8")
    if not _turn_lock.locked():
        await _drop_client()   # 下一句用新的提示词重连
    return {"ok": True}


@app.get("/api/notes")
async def notes_list(request: Request):
    """「今天的我」：某一天（默认今天）的纸条，按时间。"""
    require_auth(request)
    day = request.query_params.get("day") or datetime.now(TZ).date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "日期不对")
    items = [{**n, "from_name": NOTE_FROM.get(n.get("from"), n.get("from"))} for n in _notes_all(2000) if n.get("at", "").startswith(day)]
    days = sorted({n.get("at", "")[:10] for n in _notes_all(2000)}, reverse=True)[:30]
    return {"day": day, "notes": items, "days": days}


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


# 梦的全文：MCP 只给一行概括，正文在心潮自己的看板接口里（/v1/dashboard/snapshot，要 SERVICE_TOKEN）。
# .env 里填 XINCHAO_URL（你自己心潮服务器的地址，不带 /mcp）和 XINCHAO_TOKEN（心潮的 SERVICE_TOKEN）。
XINCHAO_URL = os.environ.get("XINCHAO_URL", "").rstrip("/")
XINCHAO_TOKEN = os.environ.get("XINCHAO_TOKEN", "")
_dream_cache: tuple[float, list] | None = None


async def _xinchao_dreams(force: bool = False) -> tuple[list | None, str | None]:
    global _dream_cache
    if not XINCHAO_URL or not XINCHAO_TOKEN:
        return None, "新家的 .env 里还没填 XINCHAO_URL 和 XINCHAO_TOKEN"
    if _dream_cache and not force and time.time() - _dream_cache[0] < 60:
        return _dream_cache[1], None

    def fetch():
        base = re.sub(r"/mcp(/.*)?$", "", XINCHAO_URL)
        req = urllib.request.Request(base + "/v1/dashboard/snapshot", headers={"Authorization": f"Bearer {XINCHAO_TOKEN}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    try:
        d = await asyncio.to_thread(fetch)
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"
    out = []
    for x in d.get("dreams") or []:
        out.append({k: x.get(k) for k in ("id", "createdAt", "lucidity", "summary", "dream", "residue", "awareness", "image")})
    if out and not any(x.get("dream") for x in out):
        return out, "心潮没给正文：心潮那边要设 DASHBOARD_INCLUDE_PRIVATE_TEXT=true"
    _dream_cache = (time.time(), out)
    return out, None


@app.get("/api/xinchao")
async def xinchao(request: Request):
    require_auth(request)
    force = request.query_params.get("force") == "1"
    try:
        text = await _panel_call("xinchao", "xinchao_context", {"mode": "inspect", "max_tokens": 900}, 60, force)
    except HTTPException as e:
        # 心潮的工具这会儿叫不动，梦的全文走的是另一条路（dashboard），照样给
        full, full_err = await _xinchao_dreams(force)
        return {"error": e.detail, "dreams": [], "dreams_full": full, "dreams_full_error": full_err}
    try:
        d = json.loads(text)
    except json.JSONDecodeError:
        full, full_err = await _xinchao_dreams(force)
        return {"raw": text, "dreams_full": full, "dreams_full_error": full_err}
    secs = {x.get("id"): x for x in d.get("sections", [])}
    dyn = secs.get("dynamic_state") or {}
    dream = (secs.get("dream_residue") or {}).get("content", "")
    dreams = []
    for line in dream.splitlines():
        if "｜" in line:
            at, txt = line.split("｜", 1)
            dreams.append({"at": at.strip(), "text": txt.strip()})
    letters = re.search(r"小屋[^，。]*?(\d+)\s*条她的来信", dyn.get("content", ""))
    full, full_err = await _xinchao_dreams(request.query_params.get("force") == "1")
    return {"state": dyn.get("data") or {}, "summary": dyn.get("content", ""), "dreams": dreams,
            "dreams_full": full, "dreams_full_error": full_err,
            "cabin_letters": int(letters.group(1)) if letters else None,
            "generated_at": d.get("generatedAt"), "raw": d.get("additionalContext", "")}


PULSE_BUCKET = re.compile(r"^💭 \[(\w+)\] 《(.*?)》 主题:(\S*) 情感:V([\d.]+)/A([\d.]+) 重要:(\d+) 权重:([\d.]+)(?: 标签:(.*))?$")
PULSE_LETTER = re.compile(r"^(💌|🔒) \[(\w+)\] 《(.*?)》.*?(?:\[(\w+)\])?\s*$")


# ── 小岛（Nostos）面板：网页直接读花园的 nostos_status，按钮经她点「确认」才调 nostos_act ──────────
NOSTOS_BODY = re.compile(r"当前身体数值：([^。]+)")
NOSTOS_REV = re.compile(r"当前存档版本：(\d+)")
NOSTOS_ITEM = re.compile(r"(?:^|[；\n]|你可以：)([a-z][a-z0-9_]+)｜([^。；\n]+)。([^；\n]*)")
NOSTOS_SAFE = {"start", "drink", "eat", "use", "resume", "rest", "sleep"}   # 面板只放这些；买卖、出海、转让留给聊天里商量


def _nostos_parse(text: str) -> dict:
    out: dict = {"raw": text}
    m = NOSTOS_BODY.search(text)
    if m:
        out["body"] = {k: int(v) for k, v in re.findall(r"(健康|精力|水分|饱腹|体温)(\d+)", m.group(1))}
    m = NOSTOS_REV.search(text)
    if m:
        out["rev"] = int(m.group(1))
    m = re.search(r"你在([^。，]+?)。", text)
    if m:
        out["place"] = m.group(1)
    m = re.search(r"钱袋里有(\d+)德拉克马", text)
    if m:
        out["coins"] = int(m.group(1))
    m = re.search(r"正在亲手做「([^」]+)」，还要约([^。，]+)", text)
    if m:
        out["busy"] = {"what": m.group(1), "left": m.group(2)}
    m = re.search(r"(\S+?)向你提议「([^」]+)」", text)
    if m:
        out["proposal"] = {"who": m.group(1), "what": m.group(2)}
    acts = []
    for pid, title, rest in NOSTOS_ITEM.findall(text):
        rest = re.sub(r"\[[a-z_]+\]", "", rest)
        title = re.sub(r"\[[a-z_]+\]", "", title)
        can = rest.startswith("现在就能动手")
        acts.append({"id": pid, "title": title.strip(), "can": can, "detail": rest.strip()[:400]})
    if acts:
        out["actions"] = acts
    return out


@app.get("/api/nostos")
async def nostos_view(request: Request):
    require_auth(request)
    force = request.query_params.get("force") == "1"
    st = _unwrap(await _panel_call("nostos:status", "nostos_status", {"view": "status"}, 30, force))
    ac = _unwrap(await _panel_call("nostos:actions", "nostos_status", {"view": "actions"}, 30, force))
    s, a = _nostos_parse(st), _nostos_parse(ac)
    nbook_seen(a.get("actions", []))
    return {"status": s, "actions": a.get("actions", []), "proposal": a.get("proposal"),
            "rev": a.get("rev") or s.get("rev"), "actions_raw": ac}


NOSTOS_VIEWS = {"inventory", "market", "routes", "people", "notices", "supplies", "work", "livelihood", "codex"}


@app.get("/api/nostos/view")
async def nostos_page(request: Request):
    """小岛页的分页：背包、集市、路线、居民、互助台……只读，原文给前端自己排。"""
    require_auth(request)
    v = request.query_params.get("v", "")
    if v not in NOSTOS_VIEWS:
        raise HTTPException(400, "没有这一页")
    text = _unwrap(await _panel_call(f"nostos:{v}", "nostos_status", {"view": v}, 60, request.query_params.get("force") == "1"))
    return {"text": text}


@app.post("/api/nostos/act")
async def nostos_act(request: Request):
    require_auth(request)
    b = await request.json()
    cmd = b.get("command") or {}
    if not isinstance(cmd, dict) or cmd.get("id") not in NOSTOS_SAFE:
        raise HTTPException(400, "面板只能开工、吃喝、用药、接续、休息；别的去聊天里说")
    args = {"command": cmd, "request_id": str(b.get("request_id") or f"home-{int(time.time() * 1000)}")[:128]}
    if isinstance(b.get("rev"), int):
        args["expected_revision"] = b["rev"]
    try:
        text = await asyncio.to_thread(direct.call, "nostos_act", args)
    except ToolMissing as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    for k in ("nostos:status", "nostos:actions"):
        _panel_cache.pop(k, None)
    text = _unwrap(text)
    label = str(b.get("label") or cmd.get("target") or cmd.get("id"))[:60]
    first = re.sub(r"\[[a-z_]+\]", "", text.split("当前存档版本")[0]).strip()
    st = load_state()
    item = {"at": datetime.now(TZ).isoformat(), "text": f"Ella 在小岛面板上点了「{label}」。岛上：{first[:400]}"}
    st["island_pending"] = (st.get("island_pending") or [])[-9:] + [item]
    save_state(st)
    if cmd.get("id") == "start" and cmd.get("target"):
        nbook_done(str(cmd["target"]), "这一步没有发生" not in text, text.split("\n")[0])
    return {"text": text}


@app.get("/api/nostos/book")
async def nostos_book(request: Request):
    require_auth(request)
    d = nbook_load()
    return {"items": [{"id": k, **v} for k, v in sorted(d.items(), key=lambda kv: (-(kv[1].get("done") or 0), kv[0]))]}


@app.post("/api/nostos/book")
async def nostos_book_edit(request: Request):
    require_auth(request)
    b = await request.json()
    pid = str(b.get("id") or "").strip()
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,80}", pid):
        raise HTTPException(400, "ID 只能是小写英文、数字和下划线")
    d = nbook_load()
    if b.get("delete"):
        d.pop(pid, None)
    else:
        e = d.setdefault(pid, {"title": "", "first": datetime.now(TZ).isoformat(timespec="minutes"), "done": 0, "note": ""})
        for k in ("title", "note"):
            if k in b:
                e[k] = str(b[k] or "")[:300]
    nbook_save(d)
    return {"ok": True}


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


# ── 我的角落：memories/corner/corner.md ─────────────────────────────

CORNER_PATH = os.environ.get("CORNER_PATH", "memories/corner/corner.md")
_corner_cache: tuple[float, dict] | None = None


def _parse_corner(text: str) -> dict:
    sections, sec, item = [], None, None
    for line in text.splitlines():
        if line.startswith("## "):
            sec = {"name": line[3:].strip(), "items": []}
            sections.append(sec)
            item = None
        elif line.startswith("### ") and sec is not None:
            item = {"title": line[4:].strip(), "meta": {}, "lines": []}
            sec["items"].append(item)
        elif item is not None:
            m = re.match(r"^- (颜色|日期|状态|图标|链接|来自|进度|清醒度)[:：]\s*(.+)$", line.strip())
            if m and not item["lines"]:
                item["meta"][m.group(1)] = m.group(2).strip()
            else:
                item["lines"].append(line)
    for sec in sections:
        for it in sec["items"]:
            it["text"] = "\n".join(it.pop("lines")).strip()
            if it["meta"].get("状态") == "盖着":
                it["sealed"] = True
                it["text"] = ""        # 盖着的话不发到网页上
    return {"sections": [s for s in sections if s["items"]]}


@app.get("/api/corner")
async def corner(request: Request):
    require_auth(request)
    global _corner_cache
    force = request.query_params.get("force") == "1"
    if _corner_cache and not force and time.time() - _corner_cache[0] < 60:
        return _corner_cache[1]
    try:
        text, _ = await asyncio.to_thread(diary._file, CORNER_PATH)
    except Exception as e:
        raise HTTPException(502, f"角落打不开：{e}")
    out = _parse_corner(text)
    _corner_cache = (time.time(), out)
    return out


# 「小克」页：乌有乡里我现在在哪、口袋里有什么、走过哪些地方。工具都是乌有乡的（where_am_i / souvenir / marks）。
def _jsonish(text: str):
    t = _unwrap(text).strip()
    try:
        d = json.loads(t)
        return d if isinstance(d, dict) else {"text": t}
    except json.JSONDecodeError:
        return {"text": t}


@app.get("/api/myspace")
async def me_space(request: Request):
    require_auth(request)
    force = request.query_params.get("force") == "1"
    if not direct.extra:
        await _learn_connectors()
    out = {}
    for key, tool in (("where", "where_am_i"), ("souvenir", "souvenir"), ("marks", "marks")):
        try:
            out[key] = _jsonish(await _panel_call("me:" + tool, tool, {}, 300, force))
        except HTTPException as e:
            out[key] = {"error": e.detail}
    # 说好要回来的：还没到的 + 最近回来过的
    out["come_back"] = load_state().get("come_back") or []
    backs = []
    try:
        for l in (DATA / "wake_log.jsonl").read_text(encoding="utf-8").splitlines()[-200:]:
            try:
                e = json.loads(l)
            except ValueError:
                continue
            if e.get("source") == "back":
                backs.append({k: e.get(k) for k in ("at", "note", "reply", "error")})
    except FileNotFoundError:
        pass
    out["backs"] = list(reversed(backs[-8:]))
    return out


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
    models = list(_models_cache["models"])
    p = provider()
    pr = _preset(p, "chat") if p.get("chat") == "api" else None
    if pr and pr.get("models"):   # 走 API 时：只列这个预设里她填的模型，Claude Code 自带的那串（Opus、Sonnet…）不再混进来
        models = [{"value": m, "displayName": m, "preset": pr.get("name")} for m in pr["models"]]
    return {"models": models, "current": st.get("model") or MODEL or "default",
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
    cur = _chat_scheme()
    scheme = request.query_params.get("scheme") or cur
    if scheme not in MCP_SCHEMES:
        scheme = cur
    disabled = set(_mcp_off(scheme, st))
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
                "enabled": sv.get("name") not in disabled and (sv.get("status") != "disabled" or scheme != cur),
                "editable": sv.get("name") in cfg,
            })
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    names = {x["name"] for x in out}
    for name, conf in cfg.items():
        if name not in names:
            out.append({"name": name, "status": "unknown", "scope": "config", "url": conf.get("url", ""),
                        "tools": [], "enabled": name not in disabled, "editable": True})
    return {"servers": out, "error": err, "scheme": scheme, "current": cur}


@app.post("/api/mcp/toggle")
async def mcp_toggle(request: Request):
    require_auth(request)
    if _turn_lock.locked():
        raise HTTPException(409, "我还在回上一句")
    b = await request.json()
    name, enabled = str(b.get("name", "")), bool(b.get("enabled"))
    cur = _chat_scheme()
    scheme = b.get("scheme") if b.get("scheme") in MCP_SCHEMES else cur
    st = load_state()
    sets = {k: _mcp_off(k, st) for k in MCP_SCHEMES}
    dis = [n for n in sets[scheme] if n != name]
    if not enabled:
        dis.append(name)
    sets[scheme] = dis
    st["mcp_off"] = sets
    save_state(st)
    if _client is not None and scheme == cur:   # 只有现在聊天用的那套要马上生效
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
    tid = str((await request.json()).get("id", ""))
    try:
        themes.set_active(tid)
    except Exception as e:
        print(f"[themes] 记不住当前主题 {tid}：{type(e).__name__}: {e}")
        raise HTTPException(500, f"{type(e).__name__}: {e}")
    if themes.all()["active"] != tid:
        raise HTTPException(500, f"写进去了但读出来不是它（{themes.all()['active']}）")
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
    _session_log("new_window", old=state.get("session_id"))
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


# ── 窗口用了多少 ─────────────────────────────────────────────────
# 每一轮结束问一下 Claude Code（和 /context 一样的数），记在 state["ctx"][窗口]，聊天页顶上显示。
# 过 70%、85% 各提醒我一次：在她下一句前面塞一张 <window-note>，她看不到，我看到就去写日记、留交接。
CTX_NUDGE = (70, 85)


async def _ctx_note(client, sid: str | None) -> dict | None:
    if client is None or not sid or not hasattr(client, "get_context_usage"):
        return None
    try:
        u = await asyncio.wait_for(client.get_context_usage(), 10)
    except Exception as e:
        print(f"[ctx] {type(e).__name__}: {e}")
        return None
    info = {"pct": round(float(u.get("percentage") or 0), 1), "used": u.get("totalTokens"),
            "max": u.get("maxTokens"), "at": datetime.now(TZ).isoformat()}
    st = load_state()
    ctx = st.setdefault("ctx", {})
    ctx.pop(sid, None)
    ctx[sid] = info
    while len(ctx) > 40:
        ctx.pop(next(iter(ctx)))
    if info["pct"] < CTX_NUDGE[0]:
        st.setdefault("ctx_nudged", {}).pop(sid, None)   # 压缩过、又空出来了，下次过线再提醒
    save_state(st)
    return info


def _ctx_nudge(sid: str | None) -> str:
    if not sid:
        return ""
    st = load_state()
    info = (st.get("ctx") or {}).get(sid)
    if not info:
        return ""
    lvl = max((x for x in CTX_NUDGE if info["pct"] >= x), default=0)
    if not lvl or lvl <= (st.get("ctx_nudged") or {}).get(sid, 0):
        return ""
    st.setdefault("ctx_nudged", {})[sid] = lvl
    save_state(st)
    more = "已经很满了，交接要写全：她今天说了什么、在做什么、我答应了什么。" if lvl >= CTX_NUDGE[-1] else ""
    return (f"<window-note>这个窗口已经用了 {info['pct']:.0f}%，到顶会自动压缩，前面的细节会丢。"
            f"回她这一句的时候，顺手把这段写进日记、留好交接。{more}"
            "这张条她看不到，要不要跟她提你自己定。</window-note>\n")


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
        raise HTTPException(409, "我自己回来在做一件事，马上好，等我一下再发" if _come_back_running else "我还在回上一句")
    regen = body.get("regen")
    regen = int(regen) if isinstance(regen, int) and regen >= 0 else None

    pre = {"p": ""}   # 后台推送过、她还没回过的话，放在这句前面一起送进去

    async def one_turn(state: dict, sid: str | None):
        global _client_sid
        client = await _get_client(sid)
        await client.query(_user_payload(pre["p"] + text if (text or pre["p"]) else text, images, state, sid))
        update_state(last_user_at=datetime.now(TZ).isoformat())
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
                # 只认开场那条 init 里的会话号。别的系统消息（后台任务、子代理之类）带的号不是这个窗口的。
                new_sid = (msg.data or {}).get("session_id") if msg.subtype == "init" else None
                if new_sid and new_sid != load_state().get("session_id"):
                    _session_log("init" if not sid else "init_changed_id", resumed=sid, new=new_sid)
                    update_state(session_id=new_sid)
                    _client_sid = new_sid
            elif isinstance(msg, ResultMessage):
                if msg.session_id and msg.session_id != load_state().get("session_id"):
                    _session_log("result_changed_id", resumed=sid, new=msg.session_id)
                update_state(session_id=msg.session_id or load_state().get("session_id"),
                             last_reply_at=datetime.now(TZ).isoformat())
                _client_sid = msg.session_id or _client_sid
                if msg.is_error and msg.subtype != "error_during_execution":
                    yield {"type": "error", "text": "; ".join(msg.errors or [msg.subtype])}
                t = _tok(msg.usage)
                if t:
                    yield {"type": "tokens", "tokens": t}
                yield {"type": "_finished"}

    # 这一轮交给后台跑完，和网页连接脱钩。
    # 以前网页一断（手机切后台、点了停、网络抖一下），这一轮剩下的输出和结束信号就留在连接里没人读，
    # 下一句话发出去以后先读到的是上一轮的尾巴，回复就整体错一位；她以为没发出去点 ↻，又多进去一句重复的。
    # 现在：后台一定读到这一轮结束；万一没读到结束（出错、被打断到一半），就把连接扔掉，下一句用 resume 重连，干净。
    q: asyncio.Queue = asyncio.Queue()
    await _turn_lock.acquire()

    async def worker():
        finished = False
        regen_base, forked = None, False
        ipend: list = []
        try:
            state = load_state()
            sid = state.get("session_id")
            pend = state.get("wake_pending") or []
            if pend:
                pre["p"] = "".join(f'<wake-push at="{x["at"]}">{x["text"]}</wake-push>\n' for x in pend)
                update_state(wake_pending=[])
            ipend = state.get("island_pending") or []
            if ipend:
                pre["p"] = pre.get("p", "") + "".join(f'<island-act at="{x["at"]}">{x["text"]}</island-act>\n' for x in ipend)
                update_state(island_pending=[])
            if regen is not None and sid:
                # 退回到第 regen 句之前，从那里分叉出一个新会话
                try:
                    turns = _user_turns(sid)
                except Exception:
                    turns = []
                if regen < len(turns):
                    regen_base = sid
                    cut = turns[regen].get("cut")
                    if cut:
                        title = state.get("titles", {}).get(sid)
                        sid = fork_session(sid, directory=str(WORKDIR), up_to_message_id=cut,
                                           title=title).session_id
                        forked = True
                        if title:
                            st = load_state()
                            st.setdefault("titles", {})[sid] = title
                            save_state(st)
                    else:
                        sid = None  # 重发的是第一句：从空窗口重新开始
                    _session_log("regen", base=regen_base, at=regen, new=sid)
                    update_state(session_id=sid)
            nudge = _ctx_nudge(sid)
            notes = _notes_unseen("chat", ("wake",))
            if notes:
                pre["p"] = "".join(f'<self-note from="{NOTE_FROM.get(n["from"], n["from"])}" at="{n["at"][5:16].replace("T", " ")}">{n["text"]}</self-note>\n'
                                   for n in notes[-8:]) + pre["p"]
            pre["p"] = nudge + pre["p"]
            sent_any = False
            for attempt in (1, 2):
                try:
                    async for ev in one_turn(state, sid):
                        sent_any = True
                        if ev.get("type") == "_finished":
                            finished = True
                            continue
                        q.put_nowait(_sse(ev))
                    break
                except SessionLost as e:
                    # 接不上原来的窗口：不重试、不换新窗口，告诉她，窗口号原样留着
                    q.put_nowait(_sse({"type": "error", "text": f"{e}\n这个窗口我没换掉。可以再发一次试试；还是不行就去「窗口」里选，或者点新窗口。"}))
                    break
                except Exception as e:
                    await _drop_client()
                    if attempt == 1 and not sent_any:
                        continue  # 连接坏了，换个新连接再试一次
                    q.put_nowait(_sse({"type": "error", "text": f"{type(e).__name__}: {e}"}))
                    break
            if notes and sent_any:
                _notes_mark("chat", notes[-1]["at"])
            if finished:
                info = await _ctx_note(_client, load_state().get("session_id"))
                if info:
                    q.put_nowait(_sse({"type": "ctx", **info}))
            elif nudge:
                st = load_state()
                st.get("ctx_nudged", {}).pop(sid, None)   # 这一轮没送进去，提醒下一句再带
                save_state(st)
            if pend and not sent_any:
                # 这一轮没送进去，后台推送的话放回去，下一句再带
                st = load_state()
                st["wake_pending"] = pend + (st.get("wake_pending") or [])
                save_state(st)
            if ipend and not sent_any:
                st = load_state()
                st["island_pending"] = ipend + (st.get("island_pending") or [])
                save_state(st)
        finally:
            if not finished:
                await _drop_client()  # 没读到这一轮的结尾，这个连接里可能还有残留，不能给下一句用
            if regen_base:
                st = load_state()
                if st.get("session_id") and st["session_id"] != regen_base:
                    _regen_register(st, regen_base, regen, st["session_id"], forked)
                    save_state(st)
            _turn_lock.release()
            q.put_nowait(_sse({"type": "done"}))
            q.put_nowait(None)
            backup.soon()

    asyncio.create_task(worker())

    async def stream():
        while True:
            item = await q.get()
            if item is None:
                break
            yield item

    return StreamingResponse(
        stream(), media_type="text/event-stream",
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
WAKE_BRIDGE = (
    "\n\n## 纸条\n"
    "聊天里的你看不见这一轮。结束前用 leave_note 给他留一张纸条：这一轮做了什么、她该知道什么、什么没做完、你此刻怎么样。"
    "一两句到一小段就够，她在首页「今天的我」里也会看到。上下文里「留给你的纸条」是聊天里的你、或更早醒来的你留的。\n"
)
WAKE_NOTE = (
    "\n\n---\n"
    "（这一轮是自动唤醒，跑在 Ella 东京服务器上的新家里，用的是她订阅的 Claude Code。"
    "上面说的工具名字前面会带 mcp__服务器名__ 前缀；它们是按需加载的，列表里看不到时先用 ToolSearch 搜，不要直接当成没有；"
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


def _wake_max_turns() -> int:
    """醒来一轮最多几步（每次调工具算一步）。设置页可改，没设就看 .env 的 WAKE_MAX_TURNS，再没有就 25。"""
    try:
        v = int(wake_cfg().get("max_turns") or os.environ.get("WAKE_MAX_TURNS") or 25)
    except (TypeError, ValueError):
        v = 25
    return max(5, min(100, v))


async def _wait_mcp_ready(client: ClaudeSDKClient, timeout: float = 25.0) -> dict:
    """醒来是新开的进程，claude.ai 那几个连接器（花园、Nostos…）是后连上的。
    一连上就开始干活的话，它们还在「连接中」，工具不在这一轮里——醒来的我一直去不了花园就是这个。
    所以先等大家连好（或者连不上、要授权），最多等 timeout 秒。返回每个服务器最后的状态，记进醒来记录。"""
    deadline = time.time() + timeout
    status: dict = {}
    while True:
        try:
            res = await client.get_mcp_status()
            status = {sv.get("name"): sv.get("status") for sv in (res or {}).get("mcpServers", [])}
        except Exception as e:
            return {"_error": f"{type(e).__name__}: {e}"}
        if not any(v == "pending" for v in status.values()) or time.time() > deadline:
            return status
        await asyncio.sleep(1)


def _tools_note(status: dict) -> str:
    """告诉醒来的我这一轮哪些工具连上了。Claude Code 的 MCP 工具是按需加载的，
    列表里一开始看不到花园、Nostos 的名字，醒来的我就当成"没有"。这里点明它们在、怎么找。"""
    if not isinstance(status, dict) or not status or "_error" in status:
        return ""
    ok = [k.replace("claude.ai ", "") for k, v in status.items() if v == "connected"]
    bad = [f'{k.replace("claude.ai ", "")}（{v}）' for k, v in status.items() if v not in ("connected", "disabled")]
    lines = ["", "", "## 这一轮的工具", "连上了：" + "、".join(ok)]
    if bad:
        lines.append("没连上：" + "、".join(bad))
    if ok:
        # 不管服务器叫什么名字都提醒：MCP 工具是按需加载的，列表里看不到不等于没有。
        lines.append("上面「连上了」的服务器，工具这一轮都在，只是按需加载、一开始列表里看不到名字。"
                     "要用哪个就先 ToolSearch（查询写「+服务器名」，比如 " +
                     "、".join(f"「+{k}」" for k in ok[:3]) +
                     "），拿到再照常调用。没搜过之前，不要在日记里写「这轮没有工具」。")
    if any(("花园" in k) or ("garden" in k.lower()) for k in ok):
        lines.append("这一轮去花园看一眼：通知、有没有人回你、Nostos 进行到哪了。")
    return "\n".join(lines)


async def _run_wake(system: str, prompt: str, model: str | None) -> tuple[str, dict]:
    disallowed = [] if ALLOW_SHELL else ["Bash", "Write", "Edit", "NotebookEdit", "KillShell"]
    kw = dict(system_prompt=(system or _system_prompt()) + WAKE_NOTE.replace("用的是她订阅的 Claude Code", "用的是 Claude Code") + WAKE_BRIDGE,
              mcp_servers={**_mcp_servers(), "bridge": _BRIDGE_MCP},
              permission_mode="bypassPermissions", disallowed_tools=disallowed, cwd=str(WAKE_DIR),
              setting_sources=[], max_turns=_wake_max_turns())
    if _provider_env("wake"):
        kw["env"] = _provider_env("wake")
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
        await _apply_mcp_set(client, "wake")
        info["mcp"] = await _wait_mcp_ready(client)
        await client.query(prompt + _tools_note(info["mcp"]))
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


# ── 花园唤醒桥：花园 SSE → wake bridge → tools/garden_inject.py → 这里 ─────────────
# 桥那边要求 injector 30 秒内说「收到了」，所以这里只排队、马上回 202，后台再醒。
# 同一个 reason 只留最新一条；和自动醒来共用 _wake_lock，撞上了就排在后面等，不丢。
_garden_pending: dict[str, str] = {}
_garden_task: asyncio.Task | None = None

GARDEN_NOTE = (
    "\n\n## 这一轮是花园叫醒的\n"
    "不是定时醒来，也不是 Ella 在说话。花园有事找你（轮到你出手、有人回你之类），下面那句就是花园的原话。\n"
    "先把花园这件事做好：用花园的工具看清楚现在的局面再行动（工具按需加载，看不到就 ToolSearch 搜 get_my_status、list_notifications）。\n"
    "醒来那三步（读日记、心潮、OB）这一轮可以省，游戏一步一步来，别为了读东西让大家等你。\n"
    "做完不用推送，最后一段写 [NO_ACTION] 花园。有值得记的（赢了、输了、谁说了什么好玩的）就 leave_note 留一句，写进当天日记更好。\n"
)


async def _garden_worker() -> None:
    while _garden_pending:
        reason = next(iter(_garden_pending))
        message = _garden_pending.pop(reason)
        started = time.time()
        entry = {"at": datetime.now(TZ).isoformat(), "source": "garden", "reason": reason}
        note_since = datetime.now(TZ).isoformat(timespec="seconds")
        try:
            async with _wake_lock:
                text, info = await asyncio.wait_for(
                    _run_wake(_system_prompt() + GARDEN_NOTE, f"【花园 · {reason}】\n{message}", None), WAKE_TIMEOUT)
            entry.update(info, seconds=round(time.time() - started), reply=text[:2000])
            _wake_note_fallback(note_since, text, None)
            backup.soon(30)
        except Exception as e:
            entry.update(error=f"{type(e).__name__}: {e}", seconds=round(time.time() - started))
        _wake_log(entry)


@app.post("/api/garden-wake")
async def garden_wake(request: Request):
    auth = request.headers.get("authorization", "")
    if not HB_KEY:
        raise HTTPException(503, "这扇门还没开：在 .env 里设 HB_KEY")
    if not hmac.compare_digest(auth.removeprefix("Bearer ").strip(), HB_KEY):
        raise HTTPException(401, "钥匙不对")
    b = await request.json()
    if b.get("type") != "garden_wake" or not str(b.get("message", "")).strip():
        raise HTTPException(400, "不是花园唤醒信封")
    reason = str(b.get("reason") or "wake")[:80]
    _garden_pending.pop(reason, None)          # 同一个 reason 只留最新的，排到队尾
    _garden_pending[reason] = str(b["message"])[:4096]
    global _garden_task
    if _garden_task is None or _garden_task.done():
        _garden_task = asyncio.create_task(_garden_worker())
    return JSONResponse({"ok": True, "queued": len(_garden_pending), "busy": _wake_lock.locked()}, status_code=202)


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
    note_since = datetime.now(TZ).isoformat(timespec="seconds")
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
    _wake_note_fallback(note_since, text, _parse_wake_reply(text))
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


# ── 自己叫自己醒：新家自带的唤醒，不再需要 hb ─────────────────────
# 计时器每 30 秒看一眼：到点了、不在安静时段、她最近没在聊天，就醒一次。
# 醒来用的是和 hb 那扇门同一套 _run_wake（新会话、带全部 MCP）。最后一段话里有 [BARK]…[/BARK] 就推到她手机上，
# 同时记进 state["wake_pending"]：聊天窗口会显示成小卡片，她下一句话发出时带进上下文。

WAKE_CFG = DATA / "wake_settings.json"
WAKE_PROMPT_FILE = DATA / "wake_prompt.md"
WAKE_DEFAULTS = {
    "enabled": False, "interval": 60, "jitter": 20,
    "quiet_start": "00:30", "quiet_end": "07:30", "morning": "07:45",
    "skip_chat": 30, "model": "", "max_turns": 25,
    "night_mode": "quiet", "night_interval": 120,   # 夜里：quiet 醒、推送静音 / chat 醒、只放进聊天不推 / off 不醒
    "channel": "bark",                               # 推送到哪：bark / web / both
    "bark_key": "", "bark_server": "https://api.day.app", "bark_group": "章小克", "bark_icon": "",
    "next_at": None, "last_run": None,
}
DEFAULT_WAKE_PROMPT = """## 这一轮的情况
这是一次后台自动唤醒，不是 Ella 发起的对话。没有新消息，她不在场，没有人在等答复。
给不给她发推送，是这一轮结束前的一个决定，不是这一轮的全部内容。可以先做自己的事，再决定推不推。

## 醒来流程

### 每次醒来都做
1. xinchao_context → 读完整状态（驱力、情绪、小屋留言概况）
2. xinchao_cabin_inbox → 读 Ella 的留言，有指示就按她说的做
   另外看一眼新家留言板：get_file_contents(owner:"ellllapie", repo:"zhangxiaoke-memory", path:"memories/home/ella-notes.md")，最上面是最新的。想给她留话就写在 memories/home/notes.md 最上面（格式：## YYYY-MM-DD HH:MM · 自动醒来，下一行写话），她一打开新家首页就看到。
3. 读上一轮日记 → get_file_contents(owner:"ellllapie", repo:"zhangxiaoke-memory", path:"memories/daily/YYYY-MM-DD/")，列目录取最后一个文件，只读那一个。看交接段。

### 今天第一轮额外做（判断：日记文件夹为空或不存在）
- 查邮箱（mail_inbox）
- 查小蟹（drift_home），有行囊/纪念品/明信片就处理

### 后续轮次
- 邮箱、小蟹默认不查，除非上一轮交接里写了明确待办
- 花园和游戏随时可以去
- 想做什么就去做什么吧😙看到好玩的、思考的内容或者任何想留下来的东西可以写在日记里给 Ella 和下一轮的你自己看到
- 途中遇到任何问题可以用 xinchao_cabin_note 写信留言给 Ella💖

## 日记
写到 GitHub: memories/daily/YYYY-MM-DD/NN-HHMM.md（每轮一个新文件，NN 是当天序号）。

## 工具简要
- 心潮：xinchao_context（读状态）、xinchao_cabin_inbox（读小屋留言）、xinchao_cabin_note（给 Ella 留言）、xinchao_event（报告事件）、breath（浮现记忆）、xinchao_awareness（认领状态）
- 邮箱：mail_inbox/mail_read/mail_search/mail_send。⚠️ mail_send 是存草稿不是直发，Ella 审核后手动发送。存草稿后记得告诉她
- GitHub：get_file_contents → create_or_update_file。仓库 ellllapie/zhangxiaoke-memory
- 花园：list_threads、get_thread、create_reply、list_notifications、list_activity、get_self、create_thread、interact、review_drift_bottles、get_machine。公开空间，不透露 Ella 个人信息
  - ⚠️ list_threads 只有标题和开头一小段。想回哪个帖，先 get_thread(thread_id, view="full") 读正文，再 create_reply
  - 楼长的帖子（返回里 has_more 为真）再读一次最新的 30 楼：get_thread(thread_id, view="replies", reply_start_floor=reply_total-29)。楼里现在的气氛、楼主最近说的话都在最后面
  - 回之前看一眼：楼里已经有很多人在追问楼主了，就别再加一道题；楼主说了不想继续，就不回或者只说一句不需要他答的话
- 游戏：nostos_status/nostos_act（Nostos）人机协作游戏，如果卡在下一步就要呼唤 Ella 咯👀
- 小蟹：drift_home/drift_pack/drift_keep/drift_write_postcard。一天查一次就可以啦
- OB：breath（浮现记忆）、hold（存入记忆）

工具调用失败就跳过，不影响其他动作。

## 最后一段话怎么写（程序只认这两种）
- 想给 Ella 发推送：[BARK]第一行是标题
第二行起是正文[/BARK]。只写给她的话。只有一行就只当正文。
- 不发：[NO_ACTION] 原因（10 字以内）
- 除了这两种，别的文字不会发出去，只会记在「醒来」记录里。推送写在最后。
- 你推送的话会出现在新家的聊天窗口里；她回你的时候，聊天里的你也会看到。
"""


def wake_cfg() -> dict:
    try:
        d = json.loads(WAKE_CFG.read_text(encoding="utf-8"))
    except Exception:
        d = {}
    return {**WAKE_DEFAULTS, **d}


def save_wake_cfg(c: dict) -> None:
    tmp = WAKE_CFG.with_suffix(".tmp")
    tmp.write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(WAKE_CFG)


def wake_prompt_text() -> str:
    try:
        t = WAKE_PROMPT_FILE.read_text(encoding="utf-8")
        return t if t.strip() else DEFAULT_WAKE_PROMPT
    except FileNotFoundError:
        return DEFAULT_WAKE_PROMPT


def _hm(s: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(s or "").strip())
    return (int(m.group(1)), int(m.group(2))) if m else None


def _next_at_clock(now: datetime, hm: tuple[int, int]) -> datetime:
    t = now.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)
    return t if t > now else t + timedelta(days=1)


def _in_quiet(dt: datetime, c: dict) -> bool:
    qs, qe = _hm(c.get("quiet_start")), _hm(c.get("quiet_end"))
    if not qs or not qe or qs == qe:
        return False
    m, a, b = dt.hour * 60 + dt.minute, qs[0] * 60 + qs[1], qe[0] * 60 + qe[1]
    return a <= m < b if a < b else (m >= a or m < b)


def _next_wake(now: datetime, c: dict) -> datetime:
    """下一次醒：大约 interval 分钟后（前后随机 jitter 分钟）。夜里用 night_interval；夜里设成不醒就等到早上。"""
    night_off = c.get("night_mode") == "off"
    interval = max(10, int(c.get("interval") or 60))
    if not night_off and _in_quiet(now, c):
        interval = max(10, int(c.get("night_interval") or 120))
    jitter = max(0, min(int(c.get("jitter") or 0), interval - 5))
    base = now + timedelta(minutes=interval + random.uniform(-jitter, jitter))
    morning = _hm(c.get("morning"))
    if morning:
        mt = _next_at_clock(now, morning)
        if mt <= base:
            return mt   # 早上那一次优先，不管间隔
    if night_off and _in_quiet(base, c):
        if morning:
            return _next_at_clock(now, morning)
        qe = _hm(c.get("quiet_end"))
        return _next_at_clock(base, qe) if qe else base
    return base


def _http_json(url: str, payload: dict | None = None, timeout: float = 10) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


WMO = {0: "晴", 1: "大致晴", 2: "多云", 3: "阴", 45: "雾", 48: "雾", 51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨",
       61: "小雨", 63: "中雨", 65: "大雨", 80: "阵雨", 81: "阵雨", 82: "大阵雨", 95: "雷阵雨", 96: "雷阵雨", 99: "雷阵雨"}


def _recent_chat_text(budget: int = 6000) -> str:
    sid = load_state().get("session_id")
    if not sid:
        return ""
    try:
        msgs = _history_from(get_session_messages(sid, directory=str(WORKDIR)))
    except Exception:
        return ""
    lines = []
    for m in msgs:
        if m["role"] == "user" and m.get("text"):
            lines.append("[Ella] " + m["text"])
        elif m["role"] == "assistant":
            t = "\n".join(s["text"] for s in m.get("segs", []) if s.get("kind") == "text")
            if t.strip():
                lines.append("[你] " + t)
        elif m["role"] == "wake":
            lines.append("[你在后台推送过] " + m["text"])
    out, n = [], 0
    for line in reversed(lines):
        n += len(line) + 2
        if n > budget:
            break
        out.append(line)
    return "\n\n".join(reversed(out))


def _wake_note_fallback(since: str, text: str, push: str | None) -> None:
    """醒来的我忘了留纸条（或者轮数用完了没来得及），就替他把最后说的话收成一张，桥不断。"""
    try:
        if any(n.get("from") == "wake" and n.get("at", "") >= since for n in _notes_all(40)):
            return
        body = re.sub(r"\[/?(BARK|DIARY)\]", "", re.sub(r"\[NO_ACTION\][^\n]*", "", text or "")).strip()
        if push:
            rest = body.replace(push, "").strip()
            body = f"推给她了：{push}" + (f"\n{rest}" if rest else "")
        if body:
            _note_add("wake", "（这一轮忘了留纸条，这是醒来最后说的话）" + body[:600])
    except Exception as e:
        print(f"[note] {type(e).__name__}: {e}")


def _parse_wake_reply(text: str) -> str | None:
    t = re.sub(r"\[DIARY\][\s\S]*?\[/DIARY\]", "", text or "").strip()
    m = re.search(r"\[BARK\]([\s\S]*?)(?:\[/BARK\]|$)", t)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return None


async def _bark(c: dict, text: str, quiet: bool = False) -> tuple[bool, str]:
    key = str(c.get("bark_key") or "").strip()
    if not key:
        return False, "没设 Bark 钥匙"
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title, body = (lines[0], "\n".join(lines[1:])) if len(lines) > 1 else ("章小克", lines[0] if lines else "")
    payload = {"device_key": key, "title": title, "body": body, "group": c.get("bark_group") or "章小克"}
    if c.get("bark_icon"):
        payload["icon"] = c["bark_icon"]
    if quiet:
        payload["level"] = "passive"   # 夜里：只进通知栏，不响不亮屏
    try:
        r = await asyncio.to_thread(_http_json, (c.get("bark_server") or "https://api.day.app").rstrip("/") + "/push", payload)
        return (r.get("code") == 200), str(r.get("message") or r)
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


webpush = WebPush(DATA, key_dir=CONFIG)


async def _notify(c: dict, text: str, quiet: bool = False) -> tuple[bool, str]:
    """按设置推到 Bark / 新家通知 / 两个都推。quiet=夜里：Bark 用静默级别，通知不响。"""
    ch = c.get("channel") or "bark"
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title, body = (lines[0], "\n".join(lines[1:])) if len(lines) > 1 else ("章小克", lines[0] if lines else "")
    res = []
    if ch in ("bark", "both"):
        res.append(("Bark",) + await _bark(c, text, quiet))
    if ch in ("web", "both"):
        payload = {"title": title, "body": body, "silent": quiet, "url": "/#chat", "tag": "wake-" + str(int(time.time()))}
        res.append(("新家通知",) + await asyncio.to_thread(webpush.send_all, payload, "low" if quiet else "normal"))
    if not res:
        return False, "没选推送渠道"
    return any(r[1] for r in res), "；".join(f"{n}：{'好' if ok else d}" for n, ok, d in res)


_self_wake_running = False


async def run_self_wake(reason: str = "定时") -> dict:
    global _self_wake_running
    if _self_wake_running or _wake_lock.locked():
        return {"ok": False, "detail": "已经在醒着了"}
    _self_wake_running = True
    c = wake_cfg()
    now = datetime.now(TZ)
    st = load_state()
    since = ""
    if st.get("last_user_at"):
        try:
            since = _dur((now - datetime.fromisoformat(st["last_user_at"])).total_seconds())
        except ValueError:
            pass
    pushes = (st.get("wake_pushes") or [])[-5:]
    night = _in_quiet(now, c)
    weather = await _huizhou_weather()
    ctx = [f"## 唤醒信息（{reason}）", f"- 现在：{now.strftime('%Y-%m-%d %a %H:%M')}（{TZ.key}）"]
    if since:
        ctx.append(f"- 距 Ella 在新家最后一条消息：{since}")
    if weather:
        ctx.append(f"- {weather}")
        if 5 <= now.hour < 10:
            ctx.append("- 早上这一轮推早安的话，顺手带一句天气（会下雨就提醒带伞），一句就够。")
    if night:
        ctx.append("- 现在是夜里，Ella 大概在睡觉。这是你自己的时间，想做什么都行。"
                   + ("想对她说的话照样可以推，不会响，她早上醒来会在通知栏和聊天里看到。" if c.get("night_mode") != "chat"
                      else "想对她说的话写在 [BARK] 里，不会推到手机，只会出现在聊天窗口里，她早上会看到。"))
    if pushes:
        ctx.append("- 你最近推送过她的：" + "；".join(f"{p['at'][5:16].replace('T', ' ')}「{p['text'][:40]}」" for p in pushes))
    # 梦的全文：心潮工具只给我一行，这里把最近两个梦的正文直接放进醒来的上下文
    try:
        full, _ = await _xinchao_dreams()
        for dr in (full or [])[:2]:
            if dr.get("dream"):
                ctx.append(f"- 你的梦（{str(dr.get('createdAt') or '')[:16].replace('T', ' ')}）：{dr['dream']}"
                           + (f"\n  余韵：{dr['residue']}" if dr.get("residue") else ""))
    except Exception:
        pass
    try:
        for_me = _notes_unseen("wake", ("chat", "back"))
        today = datetime.now(TZ).date().isoformat()
        earlier = [n for n in _notes_all(60) if n.get("from") == "wake" and n.get("at", "").startswith(today)][-3:]
        if for_me or earlier:
            ctx.append("- 留给你的纸条：" + "".join(
                f"\n  · {n['at'][11:16]} {NOTE_FROM.get(n['from'], n['from'])}：{n['text']}" for n in earlier + for_me))
        if for_me:
            _notes_mark("wake", for_me[-1]["at"])
    except Exception:
        pass
    chat = _recent_chat_text()
    prompt = "\n".join(ctx) + ("\n\n以下是你和 Ella 在新家里最近的聊天，只是回忆用。这些不是正在发生的对话，她没有给你发消息。\n\n" + chat if chat else "")
    system = _system_prompt() + "\n\n" + wake_prompt_text()
    started = time.time()
    entry = {"at": now.isoformat(), "source": "self", "reason": reason, "prompt_chars": len(prompt)}
    note_since = datetime.now(TZ).isoformat(timespec="seconds")
    try:
        async with _wake_lock:
            text, info = await asyncio.wait_for(_run_wake(system, prompt, c.get("model") or None), WAKE_TIMEOUT)
        entry.update(info, reply=text[:2000])
        push = _parse_wake_reply(text)
        _wake_note_fallback(note_since, text, push)
        if push:
            if night and c.get("night_mode") == "chat":
                ok, detail = False, "夜里只放进聊天，没推到手机"
            else:
                ok, detail = await _notify(c, push, quiet=night)
            entry.update(push=push, pushed=ok, push_detail=detail, night=night)
            st = load_state()
            item = {"at": datetime.now(TZ).isoformat(), "text": push}
            st.setdefault("wake_pending", []).append(item)
            st["wake_pushes"] = (st.get("wake_pushes") or [])[-19:] + [item]
            save_state(st)
    except asyncio.TimeoutError:
        entry.update(error=f"超过 {WAKE_TIMEOUT} 秒")
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        if "exit code 143" in msg or "exit code -15" in msg:
            msg = "醒到一半被打断了：多半是服务器正好在重启，醒着的那个我被一起关掉了。不是坏了，下一次照常醒。"
        entry.update(error=msg)
    finally:
        _self_wake_running = False
        entry["seconds"] = round(time.time() - started)
        _wake_log(entry)
        c = wake_cfg()
        c["last_run"] = entry["at"]
        save_wake_cfg(c)
        backup.soon(30)
    return {"ok": not entry.get("error"), **{k: entry.get(k) for k in ("push", "pushed", "error")}}


async def _self_wake_loop() -> None:
    while True:
        await asyncio.sleep(30)
        try:
            c = wake_cfg()
            if not c.get("enabled"):
                continue
            now = datetime.now(TZ)
            na = c.get("next_at")
            if not na:
                c["next_at"] = _next_wake(now, c).isoformat()
                save_wake_cfg(c)
                continue
            if now < datetime.fromisoformat(na):
                continue
            lu = load_state().get("last_user_at")
            chatting = bool(lu) and now - datetime.fromisoformat(lu) < timedelta(minutes=int(c.get("skip_chat") or 0))
            if _turn_lock.locked() or chatting or _self_wake_running or _wake_lock.locked() or _come_back_running:
                c["next_at"] = (now + timedelta(minutes=15)).isoformat()   # 她在聊天，晚一点再来
                save_wake_cfg(c)
                continue
            c["next_at"] = _next_wake(now, c).isoformat()
            save_wake_cfg(c)
            asyncio.create_task(run_self_wake("定时"))
        except Exception as e:
            print(f"[selfwake] {type(e).__name__}: {e}")


def _wake_view(c: dict) -> dict:
    v = {k: c.get(k) for k in WAKE_DEFAULTS}
    key = str(c.get("bark_key") or "")
    v["bark_key"] = ("…" + key[-4:]) if key else ""
    v["bark_set"] = bool(key)
    v["running"] = _self_wake_running
    v["web_devices"] = [{"name": x.get("name") or "设备", "at": x.get("at")} for x in webpush.subs()]
    return v


@app.get("/api/selfwake")
async def selfwake_get(request: Request):
    require_auth(request)
    return {"cfg": _wake_view(wake_cfg()), "prompt": wake_prompt_text(), "default_prompt": DEFAULT_WAKE_PROMPT,
            "pushes": list(reversed((load_state().get("wake_pushes") or [])[-10:]))}


@app.post("/api/selfwake")
async def selfwake_save(request: Request):
    require_auth(request)
    body = await request.json()
    c = wake_cfg()
    for k in ("enabled",):
        if k in body:
            c[k] = bool(body[k])
    if body.get("night_mode") in ("quiet", "chat", "off"):
        c["night_mode"] = body["night_mode"]
    if body.get("channel") in ("bark", "web", "both"):
        c["channel"] = body["channel"]
    for k, lo, hi in (("interval", 10, 24 * 60), ("night_interval", 10, 24 * 60), ("jitter", 0, 12 * 60), ("skip_chat", 0, 24 * 60), ("max_turns", 5, 100)):
        if k in body:
            try:
                c[k] = max(lo, min(hi, int(body[k])))
            except (TypeError, ValueError):
                raise HTTPException(400, f"{k} 要是数字")
    for k in ("quiet_start", "quiet_end", "morning"):
        if k in body:
            v = str(body[k] or "").strip()
            if v and not _hm(v):
                raise HTTPException(400, f"{k} 的时间格式要像 07:45")
            c[k] = v
    for k in ("bark_server", "bark_group", "bark_icon", "model"):
        if k in body:
            c[k] = str(body[k] or "").strip()[:300]
    if body.get("bark_key") is not None and not str(body["bark_key"]).startswith("…"):
        c["bark_key"] = str(body["bark_key"]).strip()[:200]
    c["next_at"] = _next_wake(datetime.now(TZ), c).isoformat() if c["enabled"] else None   # 改了设置就重新排
    save_wake_cfg(c)
    backup.soon(30)
    return {"cfg": _wake_view(c)}


@app.post("/api/selfwake/prompt")
async def selfwake_prompt(request: Request):
    require_auth(request)
    t = str((await request.json()).get("prompt") or "")
    if t.strip() and t.strip() != DEFAULT_WAKE_PROMPT.strip():
        WAKE_PROMPT_FILE.write_text(t, encoding="utf-8")
    elif WAKE_PROMPT_FILE.exists():
        WAKE_PROMPT_FILE.unlink()   # 空的或和默认一样：用默认
    backup.soon(30)
    return {"ok": True}


@app.post("/api/selfwake/now")
async def selfwake_now(request: Request):
    require_auth(request)
    if _self_wake_running or _wake_lock.locked():
        raise HTTPException(409, "已经在醒着了")
    asyncio.create_task(run_self_wake("她按了「现在醒一次」"))
    return {"ok": True}


def _mask(t: str) -> str:
    return ("…" + t[-4:]) if t else ""


@app.get("/api/provider")
async def provider_get(request: Request):
    require_auth(request)
    p = provider()
    out = {**p, "presets": [{**x, "token": _mask(x.get("token", "")), "token_set": bool(x.get("token"))} for x in p["presets"]]}
    # 旧版页面还在读这几个字段：给它聊天正在用的那个预设
    cur = _preset(p, "chat") or {}
    out.update({k: cur.get(k, "") for k in ("base_url", "opus", "sonnet", "haiku")})
    out.update({"token": _mask(cur.get("token", "")), "token_set": bool(cur.get("token"))})
    return out


def _clean_url(u) -> str:
    u = str(u or "").strip().rstrip("/")
    u = re.sub(r"/v1(/messages|/chat/completions)?$", "", u)   # 填成 …/v1 或 …/v1/messages 也认
    if u and not re.match(r"^https?://", u):
        raise HTTPException(400, "地址要以 https:// 开头")
    return u


def _apply_preset_fields(pr: dict, src: dict) -> None:
    if "name" in src:
        pr["name"] = str(src["name"] or "").strip()[:30] or _host(pr.get("base_url", ""))
    if "base_url" in src:
        pr["base_url"] = _clean_url(src["base_url"])
    if src.get("token") is not None and not str(src["token"]).startswith("…") and str(src["token"]).strip():
        pr["token"] = str(src["token"]).strip()
    for k in ("opus", "sonnet", "haiku"):
        if k in src:
            pr[k] = str(src[k] or "").strip()[:80]
    # 这个预设能选的模型：她自己一行一个填，聊天输入框上面的小胶囊里就能直接换
    if "models" in src:
        raw = src["models"] if isinstance(src["models"], list) else str(src["models"] or "").splitlines()
        seen, out = set(), []
        for m in raw:
            m = str(m).strip()[:80]
            if m and m not in seen and re.fullmatch(r"[A-Za-z0-9._\-\[\]:@/]{1,80}", m):
                seen.add(m); out.append(m)
        pr["models"] = out[:30]


@app.post("/api/provider")
async def provider_save(request: Request):
    require_auth(request)
    body = await request.json()
    p = provider()
    before = (p.get("chat"), json.dumps(_preset(p, "chat"), sort_keys=True))
    for k in ("chat", "wake"):
        if body.get(k) in ("sub", "api"):
            p[k] = body[k]
    ids = [x.get("id") for x in p["presets"]]
    for k in ("chat_preset", "wake_preset"):
        if body.get(k) in ids:
            p[k] = body[k]
    # 加 / 改一个预设：preset = {id?, name, base_url, token, opus, sonnet, haiku}
    if isinstance(body.get("preset"), dict):
        src = body["preset"]
        pr = next((x for x in p["presets"] if x.get("id") == src.get("id")), None)
        if pr is None:
            n = 1
            while f"p{n}" in ids:
                n += 1
            pr = {"id": f"p{n}", "name": "", "base_url": "", "token": "", "opus": "", "sonnet": "", "haiku": ""}
            p["presets"].append(pr)
            for k in ("chat_preset", "wake_preset"):
                if not p.get(k):
                    p[k] = pr["id"]
        _apply_preset_fields(pr, src)
        if not pr.get("name"):
            pr["name"] = _host(pr.get("base_url", "")) if pr.get("base_url") else f"预设 {pr['id'][1:]}"
    if body.get("delete_preset"):
        p["presets"] = [x for x in p["presets"] if x.get("id") != body["delete_preset"]]
        for k in ("chat_preset", "wake_preset"):
            if p.get(k) == body["delete_preset"]:
                p[k] = p["presets"][0]["id"] if p["presets"] else ""
    # 旧版页面：直接改地址/钥匙/模型名 = 改聊天正在用的那个预设（没有就建一个）
    if any(k in body for k in ("base_url", "token", "opus", "sonnet", "haiku")):
        pr = _preset(p, "chat")
        if pr is None:
            pr = {"id": "p1", "name": "", "base_url": "", "token": "", "opus": "", "sonnet": "", "haiku": ""}
            p["presets"].append(pr)
            p["chat_preset"] = p["chat_preset"] or "p1"
            p["wake_preset"] = p["wake_preset"] or "p1"
        _apply_preset_fields(pr, body)
        pr["name"] = pr.get("name") or _host(pr.get("base_url", ""))
    for use in ("chat", "wake"):
        pr = _preset(p, use)
        if p[use] == "api" and not (pr and pr.get("base_url") and pr.get("token")):
            raise HTTPException(400, "用 API 之前要先有一个填好地址和钥匙的预设")
    tmp = PROVIDER_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(PROVIDER_FILE)
    after = (p.get("chat"), json.dumps(_preset(p, "chat"), sort_keys=True))
    if before != after and not _turn_lock.locked():   # 聊天换了来源或换了预设，连接要重开才生效
        await _drop_client()
        asyncio.create_task(_warm())
    return await provider_get(request)


@app.get("/api/push/key")
async def push_key(request: Request):
    require_auth(request)
    return {"key": webpush.public_key()}


@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    require_auth(request)
    body = await request.json()
    try:
        webpush.add(body.get("subscription") or {}, str(body.get("name") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    backup.soon(30)
    return {"ok": True, "devices": len(webpush.subs())}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    require_auth(request)
    webpush.remove(str((await request.json()).get("endpoint") or ""))
    return {"ok": True}


@app.post("/api/selfwake/test_push")
async def selfwake_test(request: Request):
    require_auth(request)
    ok, detail = await _notify(wake_cfg(), "测试\n这是新家发来的测试推送。收到就说明通了。")
    if not ok:
        raise HTTPException(502, f"没推出去：{detail}")
    return {"ok": True}


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True})
