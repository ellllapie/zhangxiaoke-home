"""Memory town — the data the town page needs.

GET /app/memtown → {stars: [...], mind: {...}, town: {...}}
- stars: one entry per memory (id, title, topic, date, weight). Bodies never leave the server.
  Source, in order:
    1. Ombre-Brain over MCP, if RELAY_OMBRE_MCP_URL is set (its `pulse` catalogue);
    2. otherwise the companion's memory folder (RELAY_COMPANION_DIR/memory/*.md):
       each file is a topic (one house), each top-level bullet is a memory (one window).
- mind: mood from a xinchao-style service if RELAY_XINCHAO_URL is set; empty otherwise
  (the town then shows clear weather).
State (nian, recalls, dishes, shop, species, gallery answers) lives in RELAY_TOWN_STATE (default town_state.json beside the db).
Mounted from nyx_extras.register via `nyx_town.register(app, g)`.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

import httpx

OMBRE_URL = os.environ.get("RELAY_OMBRE_MCP_URL", "")
OMBRE_TOKEN = os.environ.get("RELAY_OMBRE_MCP_TOKEN", "")
XC_URL = os.environ.get("RELAY_XINCHAO_URL", "")
XC_TOKEN = os.environ.get("RELAY_XINCHAO_TOKEN", "")
COMPANION_DIR = Path(os.environ.get("RELAY_COMPANION_DIR", str(Path.home() / "companion")))
MEMORY_DIR = Path(os.environ.get("RELAY_MEMORY_DIR", str(COMPANION_DIR / "memory")))   # the folder of .md files; town/serve.py points it anywhere
_cache = {"at": 0.0, "data": None}
TTL = 120

LINE = re.compile(r"^(📌|💭|🫧|⚓|📦)\s*\[([^\]]+)\]\s*《(.*?)》\s*主题:(\S+)\s*情感:V([\d.]+)/A([\d.]+)\s*重要:(\d+)\s*权重:([\d.]+)(?:\s*标签:(.*))?$")
KIND = {"📌": "pinned", "💭": "dynamic", "🫧": "feel", "⚓": "anchor", "📦": "archive"}


def _mcp_text(body: str) -> str:
    """MCP 回的可能是 JSON，也可能是 SSE（data: 行）。取 result.content 里的文字。"""
    txt = body.strip()
    if txt.startswith("event:") or txt.startswith("data:"):
        datas = [l[5:].strip() for l in txt.splitlines() if l.startswith("data:")]
        txt = datas[-1] if datas else "{}"
    d = json.loads(txt)
    parts = (d.get("result") or {}).get("content") or []
    s = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    try:   # 有的版本把文字再包一层 {"result": "..."}
        inner = json.loads(s)
        if isinstance(inner, dict) and isinstance(inner.get("result"), str):
            s = inner["result"]
    except Exception:
        pass
    return s


async def _pulse(client: httpx.AsyncClient) -> str:
    url, tok = OMBRE_URL, OMBRE_TOKEN
    hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
           "X-Ombre-Caller": "nyx-town", "Authorization": f"Bearer {tok}"}
    r = await client.post(url, headers=hdr, json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                          "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "memtown", "version": "1"}}})
    r.raise_for_status()
    sid = r.headers.get("mcp-session-id")
    if sid:
        hdr["Mcp-Session-Id"] = sid
    await client.post(url, headers=hdr, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    r = await client.post(url, headers=hdr, json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                          "params": {"name": "pulse", "arguments": {"include_archive": True}}}, timeout=30)
    r.raise_for_status()
    return _mcp_text(r.text)


def _parse(text: str) -> list:
    stars = []
    for line in text.splitlines():
        m = LINE.match(line.strip())
        if not m:
            continue
        mark, bid, title, dom, v, a, imp, w, tags = m.groups()
        # 标题前面一般带着「2026-10-12 11-09-54」，拆成日期和名字
        dm = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2})-(\d{2})-(\d{2})\s*(.*)$", title)
        date, name = (dm.group(1), dm.group(5)) if dm else ("", title)
        stars.append({
            "id": bid, "kind": KIND.get(mark, "dynamic"), "date": date, "title": name,
            "domain": [d for d in dom.split(",") if d], "v": float(v), "a": float(a),
            "imp": int(imp), "w": float(w), "tags": [t for t in (tags or "").split(",") if t],
        })
    return stars


async def _mind(client: httpx.AsyncClient) -> dict:
    if not XC_URL:
        return {}
    try:
        r = await client.get(f"{XC_URL.rstrip('/')}/v1/state", headers={"Authorization": f"Bearer {XC_TOKEN}"}, timeout=5)
        s = r.json()
        s = s.get("state", s)
        e = s.get("emotion") or {}
        return {"valence": e.get("valence"), "arousal": e.get("arousal"), "label": e.get("label"),
                "drives": s.get("drives") or {}, "asleep": bool(s.get("sleepStartedAt"))}
    except Exception:
        return {}


_BUL = re.compile(r"^[-*]\s+(.*)$")
_DATE = re.compile(r"(20\d\d)[-/.](\d{1,2})[-/.](\d{1,2})")
_MDAY = re.compile(r"^(\d{1,2})/(\d{1,2})\b")
_LEADDATE = re.compile(r"^(?:20\d\d[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}/\d{1,2})\s*")
_MD = re.compile(r"\*\*|__|`|\[([^\]]*)\]\([^)]*\)")


def _folder() -> list:
    """No Ombre: read memory/*.md. A file = a topic, a top-level bullet = one memory.
    Weight comes from how recently the file changed, so memories you keep editing stay lit."""
    stars, now = [], time.time()
    for f in sorted(MEMORY_DIR.glob("*.md")):
        if f.name.startswith(("_", ".")):
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            continue
        age = (now - f.stat().st_mtime) / 86400
        topic = f.stem[:12]
        for line in text.splitlines():
            m = _BUL.match(line)
            if not m:
                continue
            body = _MD.sub(lambda mm: mm.group(1) or "", m.group(1)).strip()
            if len(body) < 4:
                continue
            dm, md = _DATE.search(body), _MDAY.match(body.lstrip("📌🫧 "))
            if dm:
                date = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
            elif md:
                date = time.strftime("%Y", time.localtime(f.stat().st_mtime)) + f"-{int(md.group(1)):02d}-{int(md.group(2)):02d}"
            else:
                date = time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime))
            name = _LEADDATE.sub("", body.lstrip("📌🫧 "))
            title = (re.split(r"[。；;：:，,]", name, 1)[0] or name)[:24]
            try:   # a dated bullet fades from its own date; undated ones from when the file last changed
                age_m = (now - time.mktime(time.strptime(date, "%Y-%m-%d"))) / 86400 if (dm or md) else age
            except Exception:
                age_m = age
            pinned, feel = body.startswith(("📌", "[pin]")), body.startswith("🫧")   # 📌 pinned (always lit) · 🫧 a feeling (grows as a flower)
            stars.append({"id": "md-" + hashlib.sha1(f"{f.name}:{body}".encode()).hexdigest()[:12], "kind": "pinned" if pinned else "feel" if feel else "dynamic", "date": date, "title": title.lstrip("📌🫧 ").replace("[pin]", "").strip(),
                          "domain": [topic], "v": .5, "a": .4, "imp": 5, "w": max(3.0, 10.5 - max(0, age_m) * .12), "tags": []})
    return stars


# —— 念：小镇的钱。点窗想起来、卖收成得念；每天一份告示，列快灭的窗。存在 memtown_state.json ——
STATE = Path(os.environ.get("RELAY_TOWN_STATE", str(Path(os.environ.get("RELAY_DB", str(Path(__file__).parent / "relay.db"))).parent / "town_state.json")))


def _st() -> dict:
    try:
        d = json.loads(STATE.read_text())
    except Exception:
        d = {}
    d.setdefault("nian", 0); d.setdefault("recalls", {}); d.setdefault("sold", {}); d.setdefault("notice", {}); d.setdefault("dishes", {}); d.setdefault("species", {})
    d.setdefault("shop", {"type": "cafe", "dec": {}, "sign": None, "owned": []})
    d.setdefault("gallery", {})   # the gallery: your answers under each work {piece id: [{at, text}]}
    return d


def _save(d: dict) -> None:
    tmp = STATE.with_suffix(".tmp"); tmp.write_text(json.dumps(d, ensure_ascii=False)); tmp.replace(STATE)


# —— 她的店：房型和装修拿念换。默认那套不要钱；买过的一直是她的，换来换去不再收 ——
SHOP_PRICE = {
    "type": {"cafe": 0, "paris": 20, "farm": 20, "tower": 20},
    "wall": {"奶油": 0, "豆沙": 5, "雾蓝": 5, "薄荷": 5, "红砖": 8},
    "base": {"墨绿": 0, "酒红": 5, "藏青": 5, "黑": 5},
    "awning": {"黄白": 0, "红白": 5, "绿白": 5, "粉白": 5},
    "ivy": {"0": 0, "1": 4, "2": 4, "3": 4},
    "stall": {"不摆": 0, "糖葫芦": 8, "烤肠": 8, "煎饼果子": 8, "冰粉": 8},
}


def _shop_ok(shop: dict, key: str) -> bool:
    cat, _, val = key.partition(":")
    price = SHOP_PRICE.get(cat, {}).get(val)
    return price is not None and (price == 0 or key in shop["owned"])


def _glow(s: dict) -> float:
    if s.get("kind") == "pinned":
        return 1.0
    return max(0.0, min(1.0, (s.get("w", 0) - 3.6) / 6.5))


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.localtime())


def _notice(d: dict, stars: list) -> dict:
    """每天一份：挑三扇最暗、最近三天没被想起过的窗。"""
    n = d["notice"]
    if n.get("date") != _today() and stars:
        now = time.time()
        cand = [s for s in stars if s["kind"] == "dynamic" and _glow(s) < .3 and now - d["recalls"].get(s["id"], 0) > 3 * 86400]
        cand.sort(key=lambda s: s["w"])
        n = {"date": _today(), "ids": [s["id"] for s in cand[:3]], "rescued": []}
        d["notice"] = n; _save(d)
    return n


# 新品种说明的粗查：范围跟 town/species.js 的 RULES 一样（色卡在前端量，这里只管格式和范围）
_SP_ENUM = {"habit": ["bush", "stalk", "vine", "tree", "rosette"], "shape": ["ball", "egg", "heart", "lantern", "pod", "cube", "star"], "cut": ["half", "wedge", "dice", "slice", "ring", "whole", "disc", "noodle", "dollop"]}
_BUILTIN = {"heartberry", "thoughtleaf", "boltbean", "palettemelon", "tiderice", "lanternplant", "twinpeach", "bloom"}


def _species_bad(sp) -> str:
    import re
    try:
        if not re.fullmatch(r"[a-z][a-z0-9]{2,15}", sp.get("id", "")) or sp["id"] in _BUILTIN: return "id 要 3–16 位小写字母数字，不能和自带的重"
        if not re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", sp.get("zh", "")): return "名字要 2–4 个汉字"
        if not re.fullmatch(r"[\u4e00-\u9fa5]{2}", sp.get("pre", "")): return "pre 要 2 个汉字"
        if not (0 < len(sp.get("cooked", "")) <= 8 and 0 < len(sp.get("about", "")) <= 40): return "cooked 1–8 字，about 1–40 字"
        if not all(re.fullmatch(r"#[0-9a-fA-F]{6}", sp.get(k, "")) for k in ("fruit", "leaf", "flesh")): return "颜色要 #rrggbb"
        p, f = sp["plant"], sp["fruitShape"]
        if p["habit"] not in _SP_ENUM["habit"] or f["shape"] not in _SP_ENUM["shape"] or sp["piece"]["cut"] not in _SP_ENUM["cut"]: return "habit / shape / cut 不在能选的里面"
        if not (.2 <= float(p["height"]) <= .5 and .025 <= float(f["size"]) <= .06 and int(f["count"]) == f["count"] and 1 <= f["count"] <= 6 and .7 <= float(f.get("squash", 1)) <= 1.4): return "height / size / count / squash 超范围"
        if len(json.dumps(sp, ensure_ascii=False)) > 1200: return "说明太长了"
    except Exception:
        return "说明缺项或格式不对，照指南的例子填"
    return ""


def register(app, g):
    from fastapi import Request
    import asyncio
    lock = asyncio.Lock()

    @app.post("/app/memtown/recall")
    async def memtown_recall(request: Request):
        """点一扇窗：想起来了。一条一天只算一次念；在告示上的多给。"""
        g["check_auth"](request)
        body = await request.json()
        bid = str(body.get("id", ""))[:160]
        async with lock:
            d = _st(); now = time.time(); gain = 0
            if bid and now - d["recalls"].get(bid, 0) > 86400:
                gain = 3
                if bid in d["notice"].get("ids", []) and bid not in d["notice"].get("rescued", []):
                    gain += 5; d["notice"].setdefault("rescued", []).append(bid)
            if bid:
                d["recalls"][bid] = now
            d["nian"] += gain; _save(d)
        return {"ok": True, "gain": gain, "nian": d["nian"], "notice": d["notice"]}

    @app.post("/app/memtown/sell")
    async def memtown_sell(request: Request):
        """田里收一格拿去店里卖。一格一天收一次。"""
        g["check_auth"](request)
        body = await request.json()
        bid = str(body.get("id", ""))[:160]
        async with lock:
            d = _st(); now = time.time(); gain = 0
            if bid and now - d["sold"].get(bid, 0) > 86400:
                gain = 2; d["sold"][bid] = now
            d["nian"] += gain; _save(d)
        return {"ok": True, "gain": gain, "nian": d["nian"]}

    @app.post("/app/memtown/cook")
    async def memtown_cook(request: Request):
        """厨房（10/20）：田里熟的挑一到三样下锅。用掉的格子今天就不能再卖了；头一回做出来的菜给 6 个念，之后每做一次给 1 个。"""
        g["check_auth"](request)
        body = await request.json()
        ids = [str(x)[:160] for x in (body.get("ids") or [])][:3]
        name = str(body.get("name", ""))[:40].strip()
        species = [str(x)[:24] for x in (body.get("species") or [])][:3]
        form = str(body.get("form", "plain"))[:12]
        form = form if form in ("plain", "cake", "stand", "sundae", "bento", "pizza") else "plain"
        plate = []   # 她摆的那盘：每块是哪样、在哪、转了多少；按摆的先后存，回放时能叠回去
        for p in (body.get("plate") or [])[:80]:
            try:
                plate.append({"k": str(p["k"])[:16], "x": round(max(-3, min(3, float(p["x"]))), 3), "z": round(max(-3, min(3, float(p["z"]))), 3), "r": round(float(p["r"]) % 6.2832, 2), **({"y": round(max(-1, min(3, float(p["y"]))), 3)} if "y" in p else {}), **({"s": int(p["s"]) % 100000} if "s" in p else {})})   # y 叠多高、s 那块料长什么样
            except Exception:
                continue
        if not ids or not name:
            return {"ok": False, "why": "没东西下锅"}
        async with lock:
            d = _st(); now = time.time()
            if any(now - d["sold"].get(i, 0) <= 86400 for i in ids):
                return {"ok": False, "why": "有一样今天已经收过了", "nian": d["nian"]}
            for i in ids:
                d["sold"][i] = now
            dish = d["dishes"].get(name)
            gain = 1 if dish else 6
            d["dishes"][name] = {"count": (dish or {}).get("count", 0) + 1, "first": (dish or {}).get("first", int(now)), "last": int(now), "species": species, "form": form}
            d["dishes"][name]["mems"] = ids   # 这一盘用的是哪几条记忆，端给小机的时候它尝得出来
            if dish and dish.get("fed"):
                d["dishes"][name]["fed"] = dish["fed"]
            if plate:
                d["dishes"][name]["plate"] = plate
            elif dish and dish.get("plate"):
                d["dishes"][name]["plate"] = dish["plate"]
            d["nian"] += gain; _save(d)
        return {"ok": True, "gain": gain, "nian": d["nian"], "new": not dish, "dishes": d["dishes"]}

    @app.post("/app/memtown/shop")
    async def memtown_shop(request: Request):
        """她的店：{buy: "wall:豆沙"} 花念买下；{set: {type, dec, sign}} 换上（只能换买过的或者不要钱的）。"""
        g["check_auth"](request)
        body = await request.json()
        async with lock:
            d = _st(); shop = d["shop"]
            if body.get("buy"):
                key = str(body["buy"])[:40]; cat, _, val = key.partition(":")
                price = SHOP_PRICE.get(cat, {}).get(val)
                if price is None:
                    return {"ok": False, "why": "没有这样东西"}
                if key in shop["owned"] or price == 0:
                    return {"ok": True, "nian": d["nian"], "shop": shop}
                if d["nian"] < price:
                    return {"ok": False, "why": f"还差 {price - d['nian']} 个念", "nian": d["nian"]}
                d["nian"] -= price; shop["owned"].append(key); _save(d)
                return {"ok": True, "nian": d["nian"], "shop": shop, "spent": price}
            st = body.get("set") or {}
            typ = str(st.get("type", shop["type"]))[:12]
            if not _shop_ok(shop, "type:" + typ):
                return {"ok": False, "why": "这个房型还没买"}
            dec = {}
            for cat in ("wall", "base", "awning", "ivy", "stall"):
                if cat in (st.get("dec") or {}):
                    val = str(st["dec"][cat])[:12]
                    if not _shop_ok(shop, f"{cat}:{val}"):
                        return {"ok": False, "why": "有一样还没买"}
                    dec[cat] = int(val) if cat == "ivy" else val
            sign = st.get("sign", shop.get("sign"))
            if sign:
                sign = [str(sign[0])[:16].strip(), str(sign[1] if len(sign) > 1 else "")[:20].strip()]
                sign = sign if sign[0] else None
            shop.update(type=typ, dec=dec or shop["dec"], sign=sign); _save(d)
        return {"ok": True, "nian": d["nian"], "shop": shop}

    @app.post("/app/memtown/feed")
    async def memtown_feed(request: Request):
        """端给小机吃（10/20）：记一笔，回这盘的料是哪几条记忆。真正的「尝」在聊天里，前端用她的名义递一句过去。"""
        g["check_auth"](request)
        body = await request.json()
        name = str(body.get("name", ""))[:40]
        async with lock:
            d = _st(); dish = d["dishes"].get(name)
            if not dish:
                return {"ok": False, "why": "菜谱里没有这道"}
            dish["fed"] = int(dish.get("fed", 0)) + 1; dish["lastFed"] = int(time.time()); _save(d)
        stars = {s["id"]: s for s in ((_cache["data"] or {}).get("stars") or [])}
        mems = [{"id": i, "title": stars[i]["title"], "topic": stars[i].get("topic")} for i in dish.get("mems", []) if i in stars]
        return {"ok": True, "dish": dish, "mems": mems}

    @app.post("/app/memtown/species")
    async def memtown_species(request: Request):
        """小机造的新品种（10/20，T077）：交一份说明，粗查一遍范围，进待审。细的（扁不扁、块数）前端预览页长出来再量。"""
        g["check_auth"](request)
        body = await request.json()
        sp, topic = body.get("spec") or {}, str(body.get("topic") or "")[:20]
        why = _species_bad(sp)
        if why:
            return {"ok": False, "why": why}
        async with lock:
            d = _st(); old = d["species"].get(sp["id"])
            if old and old.get("status") == "ok":
                return {"ok": False, "why": f"「{sp['id']}」已经种下了，换个 id"}
            if any(v["spec"]["zh"] == sp["zh"] and k != sp["id"] for k, v in d["species"].items()):
                return {"ok": False, "why": f"名字「{sp['zh']}」重了"}
            d["species"][sp["id"]] = {"spec": sp, "topic": topic, "by": str(body.get("by") or "")[:20], "status": "pending", "at": int(time.time())}
            _save(d)
        return {"ok": True, "status": "pending", "hint": "等人在 species.html 看长相点头"}

    @app.post("/app/memtown/species/judge")
    async def memtown_species_judge(request: Request):
        """人看过长相：ok=true 种下，false 退回。"""
        g["check_auth"](request)
        body = await request.json()
        sid = str(body.get("id", ""))[:16]
        async with lock:
            d = _st(); it = d["species"].get(sid)
            if not it:
                return {"ok": False, "why": "没有这个品种"}
            it["status"] = "ok" if body.get("ok") else "no"; it["judged"] = int(time.time())
            if body.get("note"):
                it["note"] = str(body["note"])[:120]
            _save(d)
        return {"ok": True, "species": d["species"]}

    @app.get("/app/memtown/gallery")
    async def memtown_gallery(request: Request):
        """The gallery: the lines you answered under each work."""
        g["check_auth"](request)
        return {"ok": True, "replies": _st()["gallery"]}

    @app.post("/app/memtown/gallery")
    async def memtown_gallery_reply(request: Request):
        """{id, text}: answer one line under a work's note. {id, drop: at}: take your line back."""
        g["check_auth"](request)
        body = await request.json()
        pid = str(body.get("id", ""))[:40]
        if not pid or not all(c.isalnum() or c in "-_" for c in pid):
            return {"ok": False, "why": "哪幅画？"}
        async with lock:
            d = _st(); lst = d["gallery"].setdefault(pid, [])
            if body.get("drop"):
                lst[:] = [r for r in lst if r.get("at") != body["drop"]]
            else:
                text = str(body.get("text", "")).strip()[:200]
                if not text:
                    return {"ok": False, "why": "空的"}
                lst.append({"at": int(time.time() * 1000), "text": text}); del lst[:-50]
            _save(d)
        return {"ok": True, "replies": d["gallery"]}

    @app.get("/app/memtown")
    async def memtown(request: Request, fresh: int = 0):
        g["check_auth"](request)
        now = time.time()
        if not fresh and _cache["data"] and now - _cache["at"] < TTL:
            return _with_state(_cache["data"])
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                stars = _parse(await _pulse(client)) if OMBRE_URL else _folder()
                err = None
            except Exception as ex:
                stars, err = (_cache["data"] or {}).get("stars", []), f"memory: {type(ex).__name__}"
            mind = await _mind(client)
        data = {"stars": stars, "mind": mind, "at": int(now), "error": err}
        if stars:
            _cache.update(at=now, data=data)
        return _with_state(data)

    def _with_state(data):
        d = _st()
        out = dict(data)
        out["stars"] = [dict(s, recalled=d["recalls"].get(s["id"]), sold=d["sold"].get(s["id"])) for s in data.get("stars", [])]
        out["town"] = {"nian": d["nian"], "notice": _notice(d, data.get("stars", [])), "dishes": d["dishes"], "shop": d["shop"], "prices": SHOP_PRICE, "species": d["species"]}
        return out
